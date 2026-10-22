import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { httpError } from '../utils/http-error.js';

const router = Router();

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());

const bookSlotSchema = z.object({
  slotId: uuidSchema
}).strict();

const cancelBookingSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
}).strict().optional();

const listBookingsQuerySchema = z.object({
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().trim().min(1).optional()
}).strict().refine((data) => !data.from || !data.to || new Date(data.from) < new Date(data.to));

const bookingProjection = `id, slot_id AS "slotId", patient_id AS "patientId",
  doctor_id AS "doctorId", status, idempotency_key AS "idempotencyKey",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

function replayBooking(existing, slotId) {
  if (existing.slotId !== slotId) {
    throw httpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key reused with a different request payload');
  }
  // Creation fields are immutable. Replay the creation response even after cancellation.
  return { ...existing, status: 'scheduled', updatedAt: existing.createdAt };
}

function parseRequest(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw httpError(400, 'VALIDATION_ERROR', 'Request validation failed');
  }
  return parsed.data;
}

function parseUuid(id, errorMessage = 'Invalid ID format') {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    throw httpError(400, 'INVALID_ID', errorMessage);
  }
  return parsed.data;
}

function decodeCursor(cursor) {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error();
    const createdAt = z.iso.datetime({ offset: true }).parse(parsed.createdAt);
    const id = parseUuid(parsed.id);
    return { createdAt, id };
  } catch {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor');
  }
}

function encodeCursor(item) {
  return Buffer.from(
    JSON.stringify({
      createdAt: item.cursorCreatedAt ?? new Date(item.createdAt).toISOString(),
      id: item.id
    })
  ).toString('base64');
}

/**
 * POST /api/v1/bookings
 * Book an available doctor slot. Enforces concurrency protection and idempotency.
 */
router.post('/', authenticate, requireRole('patient'), async (req, res) => {
  const { slotId } = parseRequest(bookSlotSchema, req.body);
  const patientId = req.auth.userId;

  let idempotencyKey = req.get('Idempotency-Key') ?? req.get('idempotency-key');
  if (idempotencyKey !== undefined) {
    idempotencyKey = idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw httpError(400, 'VALIDATION_ERROR', 'Idempotency-Key must contain 1 to 200 characters');
    }
  } else {
    idempotencyKey = null;
  }

  // Fast check: if idempotency key is already stored, replay or conflict
  if (idempotencyKey) {
    const existingResult = await pool.query(
      `SELECT
        id,
        slot_id AS "slotId",
        patient_id AS "patientId",
        doctor_id AS "doctorId",
        status,
        idempotency_key AS "idempotencyKey",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
       FROM consultations
       WHERE patient_id = $1 AND idempotency_key = $2`,
      [patientId, idempotencyKey]
    );

    if (existingResult.rowCount > 0) {
      return res.status(201).json({ data: replayBooking(existingResult.rows[0], slotId) });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the key even when no consultation exists yet. Row locks cannot lock absence.
    if (idempotencyKey) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify(['booking', patientId, idempotencyKey])
      ]);
      const inTxExisting = await client.query(
        `SELECT
          id,
          slot_id AS "slotId",
          patient_id AS "patientId",
          doctor_id AS "doctorId",
          status,
          idempotency_key AS "idempotencyKey",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
         FROM consultations
         WHERE patient_id = $1 AND idempotency_key = $2`,
        [patientId, idempotencyKey]
      );

      if (inTxExisting.rowCount > 0) {
        const replay = replayBooking(inTxExisting.rows[0], slotId);
        await client.query('COMMIT');
        return res.status(201).json({ data: replay });
      }
    }

    // Row lock on availability slot to serialize concurrent booking attempts
    const slotResult = await client.query(
      `SELECT id, doctor_id, starts_at, ends_at, status
       FROM availability_slots
       WHERE id = $1
       FOR UPDATE`,
      [slotId]
    );

    if (slotResult.rowCount === 0) {
      await client.query('ROLLBACK');
      throw httpError(404, 'SLOT_NOT_FOUND', 'Slot not found');
    }

    const slot = slotResult.rows[0];

    if (slot.status !== 'available') {
      await client.query('ROLLBACK');
      throw httpError(409, 'SLOT_UNAVAILABLE', 'Slot is not available for booking');
    }

    if (new Date(slot.starts_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      throw httpError(400, 'VALIDATION_ERROR', 'Cannot book a slot that has already started or elapsed');
    }

    // Doctor discoverability and approval verification
    const doctorResult = await client.query(
      `SELECT dp.user_id
       FROM doctor_profiles dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.user_id = $1
         AND u.is_active = TRUE
         AND dp.verification_status = 'approved'`,
      [slot.doctor_id]
    );

    if (doctorResult.rowCount === 0) {
      await client.query('ROLLBACK');
      throw httpError(404, 'DOCTOR_NOT_FOUND', 'Doctor is not available for booking');
    }

    // Ensure patient profile exists to satisfy FK constraint
    await client.query(
      `INSERT INTO patient_profiles (user_id, full_name)
       VALUES ($1, 'Patient')
       ON CONFLICT (user_id) DO NOTHING`,
      [patientId]
    );

    // Update slot status to booked
    await client.query(
      `UPDATE availability_slots
       SET status = 'booked', updated_at = NOW()
       WHERE id = $1`,
      [slotId]
    );

    // Insert consultation record
    let insertResult;
    try {
      insertResult = await client.query(
        `INSERT INTO consultations (slot_id, patient_id, doctor_id, status, idempotency_key)
         VALUES ($1, $2, $3, 'scheduled', $4)
         RETURNING
           id,
           slot_id AS "slotId",
           patient_id AS "patientId",
           doctor_id AS "doctorId",
           status,
           idempotency_key AS "idempotencyKey",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [slotId, patientId, slot.doctor_id, idempotencyKey]
      );
    } catch (dbError) {
      if (dbError.code === '23505') {
        // PostgreSQL aborts a transaction after a constraint error. Roll back before reading.
        await client.query('ROLLBACK');
        if (dbError.constraint === 'consultations_patient_id_idempotency_key_key') {
          const checkMatch = await client.query(
            `SELECT ${bookingProjection} FROM consultations WHERE patient_id = $1 AND idempotency_key = $2`,
            [patientId, idempotencyKey]
          );
          if (checkMatch.rowCount > 0) {
            return res.status(201).json({ data: replayBooking(checkMatch.rows[0], slotId) });
          }
          throw httpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key reused with a different request payload');
        }
        if (['consultations_slot_id_key', 'consultations_active_slot_uidx'].includes(dbError.constraint)) {
          throw httpError(409, 'SLOT_UNAVAILABLE', 'Slot is already booked');
        }
      }
      throw dbError;
    }

    const booking = insertResult.rows[0];

    // Audit log entry
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, 'BOOKING_CREATED', 'consultation', $2, $3)`,
      [
        patientId,
        booking.id,
        JSON.stringify({
          slotId,
          doctorId: slot.doctor_id,
          startsAt: slot.starts_at,
          endsAt: slot.ends_at,
          idempotencyKey
        })
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ data: booking });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors if connection already ended
    }
    throw error;
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/bookings/me
 * List the authenticated patient's own bookings with pagination and filters
 */
router.get('/me', authenticate, requireRole('patient'), async (req, res) => {
  const query = parseRequest(listBookingsQuerySchema, req.query);
  const patientId = req.auth.userId;

  const conditions = ['c.patient_id = $1'];
  const values = [patientId];

  if (query.status) {
    values.push(query.status);
    conditions.push(`c.status = $${values.length}`);
  }

  if (query.from) {
    values.push(new Date(query.from));
    conditions.push(`s.starts_at >= $${values.length}`);
  }

  if (query.to) {
    values.push(new Date(query.to));
    conditions.push(`s.ends_at <= $${values.length}`);
  }

  if (query.cursor) {
    const { createdAt, id } = decodeCursor(query.cursor);
    values.push(createdAt, id);
    conditions.push(`(c.created_at, c.id) < ($${values.length - 1}, $${values.length})`);
  }

  values.push(query.limit + 1);
  const limitPlaceholder = `$${values.length}`;

  const sql = `
    SELECT
      c.id,
      c.slot_id AS "slotId",
      c.patient_id AS "patientId",
      c.doctor_id AS "doctorId",
      dp.full_name AS "doctorName",
      dp.specialization AS "doctorSpecialty",
      s.starts_at AS "startsAt",
      s.ends_at AS "endsAt",
      c.status,
      to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt",
      c.created_at AS "createdAt",
      c.updated_at AS "updatedAt"
    FROM consultations c
    JOIN availability_slots s ON s.id = c.slot_id
    JOIN doctor_profiles dp ON dp.user_id = c.doctor_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${limitPlaceholder}
  `;

  const result = await pool.query(sql, values);
  const hasMore = result.rows.length > query.limit;
  const items = hasMore ? result.rows.slice(0, query.limit) : result.rows;
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]) : null;

  res.status(200).json({
    data: items.map(({ cursorCreatedAt, ...item }) => item),
    pagination: {
      limit: query.limit,
      nextCursor
    }
  });
});

/**
 * GET /api/v1/bookings/:bookingId
 * Read booking with resource-level authorization
 */
router.get('/:bookingId', authenticate, async (req, res) => {
  const bookingId = parseUuid(req.params.bookingId, 'Invalid booking ID format');

  const sql = `
    SELECT
      c.id,
      c.slot_id AS "slotId",
      c.patient_id AS "patientId",
      c.doctor_id AS "doctorId",
      dp.full_name AS "doctorName",
      dp.specialization AS "doctorSpecialty",
      s.starts_at AS "startsAt",
      s.ends_at AS "endsAt",
      c.status,
      c.created_at AS "createdAt",
      c.updated_at AS "updatedAt"
    FROM consultations c
    JOIN availability_slots s ON s.id = c.slot_id
    JOIN doctor_profiles dp ON dp.user_id = c.doctor_id
    WHERE c.id = $1
  `;

  const result = await pool.query(sql, [bookingId]);
  const booking = result.rows[0];

  if (!booking) {
    throw httpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }

  // Authorization: patient owner, assigned doctor, or admin
  const isPatientOwner = req.auth.role === 'patient' && req.auth.userId === booking.patientId;
  const isAssignedDoctor = req.auth.role === 'doctor' && req.auth.userId === booking.doctorId;
  const isAdmin = req.auth.role === 'admin';

  if (!isPatientOwner && !isAssignedDoctor && !isAdmin) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to view this booking');
  }

  res.status(200).json({ data: booking });
});

/**
 * POST /api/v1/bookings/:bookingId/cancel
 * Cancel an appointment and release the slot if eligible
 */
router.post('/:bookingId/cancel', authenticate, async (req, res) => {
  const bookingId = parseUuid(req.params.bookingId, 'Invalid booking ID format');
  const body = parseRequest(cancelBookingSchema, req.body);
  const reason = body?.reason ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT
        c.id,
        c.slot_id,
        c.patient_id,
        c.doctor_id,
        c.status,
        s.starts_at,
        s.ends_at
       FROM consultations c
       JOIN availability_slots s ON s.id = c.slot_id
       WHERE c.id = $1
       FOR UPDATE OF c`,
      [bookingId]
    );

    const booking = result.rows[0];
    if (!booking) {
      await client.query('ROLLBACK');
      throw httpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }

    // Authorization: patient owner, assigned doctor, or admin
    const isPatientOwner = req.auth.role === 'patient' && req.auth.userId === booking.patient_id;
    const isAssignedDoctor = req.auth.role === 'doctor' && req.auth.userId === booking.doctor_id;
    const isAdmin = req.auth.role === 'admin';

    if (!isPatientOwner && !isAssignedDoctor && !isAdmin) {
      await client.query('ROLLBACK');
      throw httpError(403, 'FORBIDDEN', 'You do not have permission to cancel this booking');
    }

    // State transition validations
    if (booking.status === 'cancelled') {
      await client.query('ROLLBACK');
      throw httpError(409, 'BOOKING_ALREADY_CANCELLED', 'Booking is already cancelled');
    }

    if (booking.status === 'completed') {
      await client.query('ROLLBACK');
      throw httpError(409, 'INVALID_STATE_TRANSITION', 'Cannot cancel a completed booking');
    }

    if (booking.status === 'in_progress') {
      await client.query('ROLLBACK');
      throw httpError(409, 'INVALID_STATE_TRANSITION', 'Cannot cancel an in-progress booking');
    }

    // Update consultation status to cancelled
    const updateResult = await client.query(
      `UPDATE consultations
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1
       RETURNING
         id,
         slot_id AS "slotId",
         patient_id AS "patientId",
         doctor_id AS "doctorId",
         status,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [bookingId]
    );

    // Slot release policy:
    // Future slots are returned to 'available'; past slots are marked 'unavailable'
    const slotNewStatus = new Date(booking.starts_at).getTime() > Date.now() ? 'available' : 'unavailable';
    await client.query(
      `UPDATE availability_slots
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [slotNewStatus, booking.slot_id]
    );

    // Audit log entry
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, 'BOOKING_CANCELLED', 'consultation', $2, $3)`,
      [
        req.auth.userId,
        bookingId,
        JSON.stringify({
          bookingId,
          slotId: booking.slot_id,
          reason,
          cancelledByRole: req.auth.role,
          slotReleased: slotNewStatus === 'available'
        })
      ]
    );

    await client.query('COMMIT');
    res.status(200).json({ data: updateResult.rows[0] });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
});

export default router;
