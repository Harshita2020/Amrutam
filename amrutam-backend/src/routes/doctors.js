import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { httpError } from '../utils/http-error.js';

const router = Router();

const uuidSchema = z.string().uuid();

const searchDoctorsQuerySchema = z.object({
  specialty: z.string().trim().min(1).max(100).optional(),
  specialization: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().trim().min(1).optional()
}).strict();

const updateDoctorProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  specialty: z.string().trim().min(1).max(100).optional(),
  specialization: z.string().trim().min(1).max(100).optional(),
  bio: z.string().trim().max(1000).nullable().optional()
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

const listSlotsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).strict();

const createSlotSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true })
}).strict().refine((data) => new Date(data.endsAt).getTime() > new Date(data.startsAt).getTime(), {
  message: 'endsAt must be after startsAt'
});

const updateSlotSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(['available', 'unavailable']).optional()
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

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
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error();
    const id = parseUuid(parsed.id);
    return { createdAt, id };
  } catch {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor');
  }
}

function encodeCursor(item) {
  return Buffer.from(
    JSON.stringify({
      createdAt: new Date(item.createdAt).toISOString(),
      id: item.id
    })
  ).toString('base64');
}

/**
 * GET /api/v1/doctors
 * Public discoverable doctor profile search with pagination & filters
 */
router.get('/', async (req, res) => {
  const query = parseRequest(searchDoctorsQuerySchema, req.query);
  const specialtyFilter = query.specialty ?? query.specialization;

  const conditions = [
    'u.is_active = TRUE',
    "dp.verification_status = 'approved'"
  ];
  const values = [];

  if (specialtyFilter) {
    values.push(specialtyFilter.toLowerCase());
    conditions.push(`LOWER(dp.specialization) = $${values.length}`);
  }

  if (query.q) {
    values.push(`%${query.q}%`);
    conditions.push(`(dp.full_name ILIKE $${values.length} OR dp.specialization ILIKE $${values.length} OR COALESCE(dp.bio, '') ILIKE $${values.length})`);
  }

  if (query.cursor) {
    const { createdAt, id } = decodeCursor(query.cursor);
    values.push(createdAt, id);
    conditions.push(`(dp.created_at, dp.user_id) < ($${values.length - 1}, $${values.length})`);
  }

  values.push(query.limit + 1);
  const limitPlaceholder = `$${values.length}`;

  const sql = `
    SELECT
      dp.user_id AS id,
      dp.full_name AS "fullName",
      dp.specialization AS specialty,
      dp.specialization AS specialization,
      dp.bio,
      dp.created_at AS "createdAt"
    FROM doctor_profiles dp
    JOIN users u ON u.id = dp.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY dp.created_at DESC, dp.user_id DESC
    LIMIT ${limitPlaceholder}
  `;

  const result = await pool.query(sql, values);
  const hasMore = result.rows.length > query.limit;
  const items = hasMore ? result.rows.slice(0, query.limit) : result.rows;
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]) : null;

  res.status(200).json({
    data: items,
    pagination: {
      limit: query.limit,
      nextCursor
    }
  });
});

/**
 * PATCH /api/v1/doctors/me
 * Authenticated doctor updates permitted fields on their own profile
 */
router.patch('/me', authenticate, requireRole('doctor'), async (req, res) => {
  const updates = parseRequest(updateDoctorProfileSchema, req.body);
  const specialtyValue = updates.specialty ?? updates.specialization;

  const existingResult = await pool.query(
    'SELECT user_id, full_name, specialization, bio, created_at, updated_at FROM doctor_profiles WHERE user_id = $1',
    [req.auth.userId]
  );
  const existing = existingResult.rows[0];

  if (!existing) {
    if (updates.fullName && specialtyValue) {
      const insertResult = await pool.query(
        `INSERT INTO doctor_profiles (user_id, full_name, specialization, bio)
         VALUES ($1, $2, $3, $4)
         RETURNING user_id AS id, full_name AS "fullName", specialization AS specialty, specialization, bio, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [req.auth.userId, updates.fullName, specialtyValue, updates.bio ?? null]
      );
      return res.status(200).json({ data: insertResult.rows[0] });
    }
    throw httpError(404, 'DOCTOR_NOT_FOUND', 'Doctor profile not found');
  }

  const newFullName = updates.fullName ?? existing.full_name;
  const newSpecialization = specialtyValue ?? existing.specialization;
  const newBio = 'bio' in updates ? updates.bio : existing.bio;

  const updateResult = await pool.query(
    `UPDATE doctor_profiles
     SET full_name = $1, specialization = $2, bio = $3, updated_at = NOW()
     WHERE user_id = $4
     RETURNING user_id AS id, full_name AS "fullName", specialization AS specialty, specialization, bio, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [newFullName, newSpecialization, newBio, req.auth.userId]
  );

  res.status(200).json({ data: updateResult.rows[0] });
});

/**
 * POST /api/v1/doctors/me/slots
 * Authenticated doctor creates an availability slot with transactional overlap protection
 */
router.post('/me/slots', authenticate, requireRole('doctor'), async (req, res) => {
  const { startsAt, endsAt } = parseRequest(createSlotSchema, req.body);

  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);

  if (startDate.getTime() <= Date.now()) {
    throw httpError(400, 'VALIDATION_ERROR', 'Slot start time must be in the future');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const doctorCheck = await client.query(
      'SELECT user_id FROM doctor_profiles WHERE user_id = $1 FOR UPDATE',
      [req.auth.userId]
    );
    if (doctorCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      throw httpError(404, 'DOCTOR_NOT_FOUND', 'Doctor profile not found');
    }

    const overlapResult = await client.query(
      `SELECT id FROM availability_slots
       WHERE doctor_id = $1
         AND status != 'unavailable'
         AND starts_at < $3
         AND ends_at > $2
       LIMIT 1`,
      [req.auth.userId, startDate, endDate]
    );

    if (overlapResult.rowCount > 0) {
      await client.query('ROLLBACK');
      throw httpError(409, 'SLOT_OVERLAP', 'Slot overlaps with an existing slot');
    }

    const insertResult = await client.query(
      `INSERT INTO availability_slots (doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, 'available')
       RETURNING id, doctor_id AS "doctorId", starts_at AS "startsAt", ends_at AS "endsAt", status, created_at AS "createdAt"`,
      [req.auth.userId, startDate, endDate]
    );

    await client.query('COMMIT');
    res.status(201).json({ data: insertResult.rows[0] });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors if connection was already closed
    }
    throw error;
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/v1/doctors/me/slots/:slotId
 * Authenticated doctor updates their own unbooked slot
 */
router.patch('/me/slots/:slotId', authenticate, requireRole('doctor'), async (req, res) => {
  const slotId = parseUuid(req.params.slotId, 'Invalid slot ID format');
  const updates = parseRequest(updateSlotSchema, req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Same lock/order as creation: serialize all overlap-changing writes for this doctor.
    await client.query('SELECT user_id FROM doctor_profiles WHERE user_id = $1 FOR UPDATE', [req.auth.userId]);

    const slotResult = await client.query(
      'SELECT id, doctor_id, starts_at, ends_at, status FROM availability_slots WHERE id = $1 FOR UPDATE',
      [slotId]
    );
    const slot = slotResult.rows[0];

    if (!slot) {
      await client.query('ROLLBACK');
      throw httpError(404, 'SLOT_NOT_FOUND', 'Slot not found');
    }

    if (slot.doctor_id !== req.auth.userId) {
      await client.query('ROLLBACK');
      throw httpError(403, 'FORBIDDEN', 'You do not have permission to modify this slot');
    }

    if (slot.status === 'booked') {
      await client.query('ROLLBACK');
      throw httpError(409, 'SLOT_ALREADY_BOOKED', 'Cannot update a booked slot');
    }

    // Cancelled consultation history still refers to these times. Use a new slot to reschedule.
    if (updates.startsAt || updates.endsAt) {
      const references = await client.query('SELECT id FROM consultations WHERE slot_id = $1 LIMIT 1', [slotId]);
      if (references.rowCount > 0) {
        throw httpError(409, 'SLOT_REFERENCED', 'Cannot change timings of a slot referenced by a consultation');
      }
    }

    const newStartsAt = updates.startsAt ? new Date(updates.startsAt) : new Date(slot.starts_at);
    const newEndsAt = updates.endsAt ? new Date(updates.endsAt) : new Date(slot.ends_at);
    const newStatus = updates.status ?? slot.status;

    if (newEndsAt.getTime() <= newStartsAt.getTime()) {
      await client.query('ROLLBACK');
      throw httpError(400, 'VALIDATION_ERROR', 'endsAt must be after startsAt');
    }

    if ((updates.startsAt || updates.endsAt || newStatus === 'available') && newStartsAt.getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      throw httpError(400, 'VALIDATION_ERROR', 'Slot start time must be in the future');
    }

    if (newStatus !== 'unavailable') {
      const overlapResult = await client.query(
        `SELECT id FROM availability_slots
         WHERE doctor_id = $1
           AND id != $2
           AND status != 'unavailable'
           AND starts_at < $4
           AND ends_at > $3
         LIMIT 1`,
        [req.auth.userId, slotId, newStartsAt, newEndsAt]
      );

      if (overlapResult.rowCount > 0) {
        await client.query('ROLLBACK');
        throw httpError(409, 'SLOT_OVERLAP', 'Slot overlaps with an existing slot');
      }
    }

    const updateResult = await client.query(
      `UPDATE availability_slots
       SET starts_at = $1, ends_at = $2, status = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, doctor_id AS "doctorId", starts_at AS "startsAt", ends_at AS "endsAt", status, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [newStartsAt, newEndsAt, newStatus, slotId]
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

/**
 * DELETE /api/v1/doctors/me/slots/:slotId
 * Authenticated doctor deletes an unbooked, unreferenced own slot
 */
router.delete('/me/slots/:slotId', authenticate, requireRole('doctor'), async (req, res) => {
  const slotId = parseUuid(req.params.slotId, 'Invalid slot ID format');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const slotResult = await client.query(
      'SELECT id, doctor_id, status FROM availability_slots WHERE id = $1 FOR UPDATE',
      [slotId]
    );
    const slot = slotResult.rows[0];

    if (!slot) {
      await client.query('ROLLBACK');
      throw httpError(404, 'SLOT_NOT_FOUND', 'Slot not found');
    }

    if (slot.doctor_id !== req.auth.userId) {
      await client.query('ROLLBACK');
      throw httpError(403, 'FORBIDDEN', 'You do not have permission to delete this slot');
    }

    if (slot.status === 'booked') {
      await client.query('ROLLBACK');
      throw httpError(409, 'SLOT_ALREADY_BOOKED', 'Cannot delete a booked slot');
    }

    const consultationCheck = await client.query(
      'SELECT id FROM consultations WHERE slot_id = $1 LIMIT 1',
      [slotId]
    );
    if (consultationCheck.rowCount > 0) {
      await client.query('ROLLBACK');
      throw httpError(409, 'SLOT_REFERENCED', 'Cannot delete a slot referenced by a consultation');
    }

    await client.query('DELETE FROM availability_slots WHERE id = $1', [slotId]);

    await client.query('COMMIT');
    res.status(200).json({ data: { id: slotId, deleted: true } });
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

/**
 * GET /api/v1/doctors/:doctorId/slots
 * Public list of future available slots for a discoverable doctor
 */
router.get('/:doctorId/slots', async (req, res) => {
  const doctorId = parseUuid(req.params.doctorId, 'Invalid doctor ID format');
  const query = parseRequest(listSlotsQuerySchema, req.query);

  const doctorResult = await pool.query(
    `SELECT dp.user_id FROM doctor_profiles dp
     JOIN users u ON u.id = dp.user_id
     WHERE dp.user_id = $1
       AND u.is_active = TRUE
       AND dp.verification_status = 'approved'`,
    [doctorId]
  );

  if (doctorResult.rowCount === 0) {
    throw httpError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
  }

  const conditions = [
    'doctor_id = $1',
    "status = 'available'",
    'starts_at >= NOW()'
  ];
  const values = [doctorId];

  if (query.from) {
    values.push(new Date(query.from));
    conditions.push(`starts_at >= $${values.length}`);
  }

  if (query.to) {
    values.push(new Date(query.to));
    conditions.push(`ends_at <= $${values.length}`);
  }

  values.push(query.limit);
  const limitPlaceholder = `$${values.length}`;

  const sql = `
    SELECT
      id,
      doctor_id AS "doctorId",
      starts_at AS "startsAt",
      ends_at AS "endsAt",
      status,
      created_at AS "createdAt"
    FROM availability_slots
    WHERE ${conditions.join(' AND ')}
    ORDER BY starts_at ASC
    LIMIT ${limitPlaceholder}
  `;

  const slotsResult = await pool.query(sql, values);
  res.status(200).json({ data: slotsResult.rows });
});

/**
 * GET /api/v1/doctors/:doctorId
 * Public read of a single discoverable doctor profile
 */
router.get('/:doctorId', async (req, res) => {
  const doctorId = parseUuid(req.params.doctorId, 'Invalid doctor ID format');

  const result = await pool.query(
    `SELECT
      dp.user_id AS id,
      dp.full_name AS "fullName",
      dp.specialization AS specialty,
      dp.specialization AS specialization,
      dp.bio,
      dp.created_at AS "createdAt"
    FROM doctor_profiles dp
    JOIN users u ON u.id = dp.user_id
    WHERE dp.user_id = $1
      AND u.is_active = TRUE
      AND dp.verification_status = 'approved'`,
    [doctorId]
  );

  const doctor = result.rows[0];
  if (!doctor) {
    throw httpError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
  }

  res.status(200).json({ data: doctor });
});

export default router;
