import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';

const { query, client } = vi.hoisted(() => {
  const query = vi.fn();
  const clientQuery = vi.fn();
  const clientRelease = vi.fn();
  const client = { query: clientQuery, release: clientRelease };
  return { query, client };
});

vi.mock('../src/config/db.js', () => ({
  pool: {
    query,
    connect: vi.fn().mockResolvedValue(client)
  }
}));

const patient1Id = '79d214bb-68aa-4b04-95bf-123bd69da4a7';
const patient2Id = '79d214bb-68aa-4b04-95bf-123bd69da4a8';
const doctor1Id = '89d214bb-68aa-4b04-95bf-123bd69da4a8';
const doctor2Id = '89d214bb-68aa-4b04-95bf-123bd69da4a9';
const adminId = '99d214bb-68aa-4b04-95bf-123bd69da4a1';
const slotId = '11d214bb-68aa-4b04-95bf-123bd69da411';
const slot2Id = '11d214bb-68aa-4b04-95bf-123bd69da422';
const bookingId = '22d214bb-68aa-4b04-95bf-123bd69da422';

describe('Phase 4 hardening regressions', () => {
  it.each([slotId, slot2Id])('rolls back a unique-key error before recovering stored request %s', async (storedSlotId) => {
    query.mockResolvedValueOnce({ rows: [{ id: patient1Id, role: 'patient', is_active: true }] });
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const existing = { id: bookingId, slotId: storedSlotId, patientId: patient1Id,
      doctorId: doctor1Id, status: 'scheduled', idempotencyKey: 'external-writer',
      createdAt: '2026-10-22T12:00:00.000Z', updatedAt: '2026-10-22T12:00:00.000Z' };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // advisory key lock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // key lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: slotId, doctor_id: doctor1Id,
        status: 'available', starts_at: new Date(Date.now() + 86400000), ends_at: new Date(Date.now() + 90000000) }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: doctor1Id }] })
      .mockResolvedValueOnce({ rows: [] }) // patient profile
      .mockResolvedValueOnce({ rows: [] }) // slot reservation
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), {
        code: '23505', constraint: 'consultations_patient_id_idempotency_key_key'
      }))
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK before querying again
      .mockResolvedValueOnce({ rowCount: 1, rows: [existing] });
    const response = await request(app).post('/api/v1/bookings')
      .set('Authorization', `Bearer ${tokenFor(patient1Id)}`)
      .set('Idempotency-Key', 'external-writer').send({ slotId });
    expect(client.query.mock.calls[8][0]).toBe('ROLLBACK');
    expect(client.query.mock.calls[9][0]).toContain('FROM consultations');
    expect(response.status).toBe(storedSlotId === slotId ? 201 : 409);
    if (storedSlotId === slotId) expect(response.body.data).toEqual(existing);
    else expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
  });

  it('rejects an overlong idempotency key before starting a transaction', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: patient1Id, role: 'patient', is_active: true }] });
    const response = await request(app).post('/api/v1/bookings')
      .set('Authorization', `Bearer ${tokenFor(patient1Id)}`)
      .set('Idempotency-Key', 'x'.repeat(201)).send({ slotId });
    expect(response.status).toBe(400);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rejects an array cancellation body', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: patient1Id, role: 'patient', is_active: true }] });
    const response = await request(app).post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(patient1Id)}`).send([]);
    expect(response.status).toBe(400);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rejects reversed date ranges', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: patient1Id, role: 'patient', is_active: true }] });
    const response = await request(app).get('/api/v1/bookings/me?from=2026-10-25T10:00:00Z&to=2026-10-24T10:00:00Z')
      .set('Authorization', `Bearer ${tokenFor(patient1Id)}`);
    expect(response.status).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

function tokenFor(userId, role = 'patient') {
  return jwt.sign({ role }, env.JWT_SECRET, { algorithm: 'HS256', subject: userId, expiresIn: '15m' });
}

beforeEach(() => {
  query.mockReset();
  client.query.mockReset();
  client.release.mockReset();
});

describe('POST /api/v1/bookings (Create Appointment Booking)', () => {
  const futureStartsAt = new Date(Date.now() + 86400000).toISOString(); // +1 day
  const futureEndsAt = new Date(Date.now() + 86400000 + 1800000).toISOString(); // +30 mins

  it('allows an authenticated patient to book an available slot', async () => {
    const token = tokenFor(patient1Id, 'patient');

    // 1. authenticate middleware
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'patient@example.com', role: 'patient', is_active: true }]
    });

    // Transaction mock
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: slotId, doctor_id: doctor1Id, starts_at: futureStartsAt, ends_at: futureEndsAt, status: 'available' }]
      }) // Lock slot FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: doctor1Id }] }) // Doctor approved check
      .mockResolvedValueOnce({ rows: [] }) // Insert patient profile ON CONFLICT DO NOTHING
      .mockResolvedValueOnce({ rows: [] }) // Update slot to 'booked'
      .mockResolvedValueOnce({
        rows: [{
          id: bookingId,
          slotId,
          patientId: patient1Id,
          doctorId: doctor1Id,
          status: 'scheduled',
          idempotencyKey: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      }) // Insert consultation
      .mockResolvedValueOnce({ rows: [] }) // Insert audit log
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(bookingId);
    expect(response.body.data.slotId).toBe(slotId);
    expect(response.body.data.patientId).toBe(patient1Id);
    expect(response.body.data.status).toBe('scheduled');
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects unauthenticated requests with 401 UNAUTHENTICATED', async () => {
    const response = await request(app)
      .post('/api/v1/bookings')
      .send({ slotId });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects doctor and admin roles from creating bookings with 403 FORBIDDEN', async () => {
    const doctorToken = tokenFor(doctor1Id, 'doctor');
    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'doc@example.com', role: 'doctor', is_active: true }]
    });

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ slotId });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects malformed slotId with 400 VALIDATION_ERROR', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId: 'not-a-uuid' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unexpected body fields with 400 VALIDATION_ERROR', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId, patientId: patient2Id });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty Idempotency-Key header with 400 VALIDATION_ERROR', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', '   ')
      .send({ slotId });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 SLOT_NOT_FOUND when the slot does not exist', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // Lock slot -> empty
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('SLOT_NOT_FOUND');
    expect(client.release).toHaveBeenCalled();
  });

  it('returns 409 SLOT_UNAVAILABLE if slot is already booked or unavailable', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: slotId, doctor_id: doctor1Id, starts_at: futureStartsAt, ends_at: futureEndsAt, status: 'booked' }]
      }) // Already booked!
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('rejects booking past/elapsed slots with 400 VALIDATION_ERROR', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    const pastStarts = '2020-01-01T09:00:00.000Z';
    const pastEnds = '2020-01-01T09:30:00.000Z';

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: slotId, doctor_id: doctor1Id, starts_at: pastStarts, ends_at: pastEnds, status: 'available' }]
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('elapsed');
  });

  it('returns 404 DOCTOR_NOT_FOUND if the doctor is inactive or not approved', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: slotId, doctor_id: doctor1Id, starts_at: futureStartsAt, ends_at: futureEndsAt, status: 'available' }]
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // Doctor check fails
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('DOCTOR_NOT_FOUND');
  });

  it('enforces database-level concurrency protection if unique constraint 23505 fires', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    const dbConstraintError = new Error('duplicate key value violates unique constraint');
    dbConstraintError.code = '23505';
    dbConstraintError.constraint = 'consultations_slot_id_key';

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: slotId, doctor_id: doctor1Id, starts_at: futureStartsAt, ends_at: futureEndsAt, status: 'available' }]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: doctor1Id }] })
      .mockResolvedValueOnce({ rows: [] }) // patient_profiles
      .mockResolvedValueOnce({ rows: [] }) // update availability_slots
      .mockRejectedValueOnce(dbConstraintError) // insert consultation triggers unique constraint race
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SLOT_UNAVAILABLE');
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back transaction cleanly when an unexpected database error occurs', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('Connection terminated'));

    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(client.release).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe('Idempotency for POST /api/v1/bookings', () => {
  const futureStartsAt = new Date(Date.now() + 86400000).toISOString();
  const futureEndsAt = new Date(Date.now() + 86400000 + 1800000).toISOString();

  it('replays the original outcome when repeated with the same idempotency key and same slotId', async () => {
    const token = tokenFor(patient1Id, 'patient');
    const idempotencyKey = 'idem-key-12345';

    // 1. authenticate
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'patient@example.com', role: 'patient', is_active: true }]
    });
    // 2. fast idempotency check finds prior consultation with same slotId
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: bookingId,
        slotId,
        patientId: patient1Id,
        doctorId: doctor1Id,
        status: 'scheduled',
        idempotencyKey,
        createdAt: '2026-10-22T12:00:00.000Z',
        updatedAt: '2026-10-22T12:00:00.000Z'
      }]
    });

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ slotId });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(bookingId);
    expect(response.body.data.slotId).toBe(slotId);
    // Did not open transaction
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rejects reuse of the same idempotency key with a different slotId with 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const token = tokenFor(patient1Id, 'patient');
    const idempotencyKey = 'idem-key-12345';

    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'patient@example.com', role: 'patient', is_active: true }]
    });
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: bookingId,
        slotId: slot2Id, // different slot!
        patientId: patient1Id,
        doctorId: doctor1Id,
        status: 'scheduled',
        idempotencyKey,
        createdAt: '2026-10-22T12:00:00.000Z',
        updatedAt: '2026-10-22T12:00:00.000Z'
      }]
    });

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ slotId }); // slotId != slot2Id

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('handles in-transaction idempotency detection when key is committed during in-flight check', async () => {
    const token = tokenFor(patient1Id, 'patient');
    const idempotencyKey = 'idem-in-flight-999';

    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'patient@example.com', role: 'patient', is_active: true }]
    });
    // fast check returns empty (not yet visible outside tx)
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    // in tx lock check finds it
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // Serialize the idempotency key
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: bookingId,
          slotId,
          patientId: patient1Id,
          doctorId: doctor1Id,
          status: 'scheduled',
          idempotencyKey,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ slotId });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(bookingId);
  });
});

describe('GET /api/v1/bookings/me (List Patient Bookings)', () => {
  it('returns the authenticated patient bookings with pagination and filters', async () => {
    const token = tokenFor(patient1Id, 'patient');

    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    const bookingRow = {
      id: bookingId,
      slotId,
      patientId: patient1Id,
      doctorId: doctor1Id,
      doctorName: 'Dr. Aisha Sharma',
      doctorSpecialty: 'Ayurveda',
      startsAt: '2026-10-25T09:00:00.000Z',
      endsAt: '2026-10-25T09:30:00.000Z',
      status: 'scheduled',
      createdAt: '2026-10-22T10:00:00.000Z',
      updatedAt: '2026-10-22T10:00:00.000Z'
    };

    query.mockResolvedValueOnce({ rows: [bookingRow] });

    const response = await request(app)
      .get('/api/v1/bookings/me?limit=10&status=scheduled')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(bookingId);
    expect(response.body.pagination.limit).toBe(10);
    expect(response.body.pagination.nextCursor).toBeNull();

    const [sql, values] = query.mock.calls[1];
    expect(sql).toContain('c.patient_id = $1');
    expect(sql).toContain('c.status = $2');
    expect(values[0]).toBe(patient1Id);
    expect(values[1]).toBe('scheduled');
  });

  it('rejects doctor access to /bookings/me with 403 FORBIDDEN', async () => {
    const doctorToken = tokenFor(doctor1Id, 'doctor');
    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'doc@example.com', role: 'doctor', is_active: true }]
    });

    const response = await request(app)
      .get('/api/v1/bookings/me')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/v1/bookings/:bookingId (Read Booking)', () => {
  const bookingData = {
    id: bookingId,
    slotId,
    patientId: patient1Id,
    doctorId: doctor1Id,
    doctorName: 'Dr. Aisha',
    doctorSpecialty: 'Ayurveda',
    startsAt: '2026-10-25T09:00:00.000Z',
    endsAt: '2026-10-25T09:30:00.000Z',
    status: 'scheduled',
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z'
  };

  it('allows the owning patient to view the booking', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });
    query.mockResolvedValueOnce({ rows: [bookingData] });

    const response = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(bookingId);
  });

  it('allows the assigned doctor to view the booking', async () => {
    const token = tokenFor(doctor1Id, 'doctor');
    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'doc@example.com', role: 'doctor', is_active: true }]
    });
    query.mockResolvedValueOnce({ rows: [bookingData] });

    const response = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.doctorId).toBe(doctor1Id);
  });

  it('allows an admin to view the booking', async () => {
    const token = tokenFor(adminId, 'admin');
    query.mockResolvedValueOnce({
      rows: [{ id: adminId, email: 'admin@example.com', role: 'admin', is_active: true }]
    });
    query.mockResolvedValueOnce({ rows: [bookingData] });

    const response = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(bookingId);
  });

  it('prevents an unauthorized patient from viewing someone else booking with 403 FORBIDDEN', async () => {
    const token = tokenFor(patient2Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient2Id, email: 'other@example.com', role: 'patient', is_active: true }]
    });
    query.mockResolvedValueOnce({ rows: [bookingData] });

    const response = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('prevents an unassigned doctor from viewing the booking with 403 FORBIDDEN', async () => {
    const token = tokenFor(doctor2Id, 'doctor');
    query.mockResolvedValueOnce({
      rows: [{ id: doctor2Id, email: 'otherdoc@example.com', role: 'doctor', is_active: true }]
    });
    query.mockResolvedValueOnce({ rows: [bookingData] });

    const response = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 BOOKING_NOT_FOUND when booking does not exist', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });
    query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('BOOKING_NOT_FOUND');
  });

  it('returns 400 INVALID_ID for a malformed bookingId', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    const response = await request(app)
      .get('/api/v1/bookings/bad-uuid')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ID');
  });
});

describe('POST /api/v1/bookings/:bookingId/cancel (Cancel Appointment)', () => {
  const futureStartsAt = new Date(Date.now() + 86400000).toISOString();
  const futureEndsAt = new Date(Date.now() + 86400000 + 1800000).toISOString();

  it('allows the patient owner to cancel a scheduled booking and releases the slot', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: bookingId,
          slot_id: slotId,
          patient_id: patient1Id,
          doctor_id: doctor1Id,
          status: 'scheduled',
          starts_at: futureStartsAt,
          ends_at: futureEndsAt
        }]
      }) // Select consultation for update
      .mockResolvedValueOnce({
        rows: [{
          id: bookingId,
          slotId,
          patientId: patient1Id,
          doctorId: doctor1Id,
          status: 'cancelled',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      }) // Update consultation to cancelled
      .mockResolvedValueOnce({ rows: [] }) // Update slot to available
      .mockResolvedValueOnce({ rows: [] }) // Insert audit log
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Feeling better' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('cancelled');

    // Verify slot was released to 'available'
    const [, slotUpdateValues] = client.query.mock.calls[3];
    expect(slotUpdateValues[0]).toBe('available');
    expect(slotUpdateValues[1]).toBe(slotId);
  });

  it('allows the assigned doctor to cancel the booking', async () => {
    const token = tokenFor(doctor1Id, 'doctor');
    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'doc@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: bookingId,
          slot_id: slotId,
          patient_id: patient1Id,
          doctor_id: doctor1Id,
          status: 'scheduled',
          starts_at: futureStartsAt,
          ends_at: futureEndsAt
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: bookingId,
          slotId,
          patientId: patient1Id,
          doctorId: doctor1Id,
          status: 'cancelled',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      })
      .mockResolvedValueOnce({ rows: [] }) // slot update
      .mockResolvedValueOnce({ rows: [] }) // audit log
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('cancelled');
  });

  it('prevents an unauthorized user from cancelling someone else booking with 403 FORBIDDEN', async () => {
    const token = tokenFor(patient2Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient2Id, email: 'other@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: bookingId,
          slot_id: slotId,
          patient_id: patient1Id,
          doctor_id: doctor1Id,
          status: 'scheduled',
          starts_at: futureStartsAt,
          ends_at: futureEndsAt
        }]
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects cancellation of an already cancelled booking with 409 BOOKING_ALREADY_CANCELLED', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: bookingId,
          slot_id: slotId,
          patient_id: patient1Id,
          doctor_id: doctor1Id,
          status: 'cancelled',
          starts_at: futureStartsAt,
          ends_at: futureEndsAt
        }]
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('BOOKING_ALREADY_CANCELLED');
  });

  it('rejects cancellation of a completed booking with 409 INVALID_STATE_TRANSITION', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: bookingId,
          slot_id: slotId,
          patient_id: patient1Id,
          doctor_id: doctor1Id,
          status: 'completed',
          starts_at: futureStartsAt,
          ends_at: futureEndsAt
        }]
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejects cancellation of an in-progress booking with 409 INVALID_STATE_TRANSITION', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: bookingId,
          slot_id: slotId,
          patient_id: patient1Id,
          doctor_id: doctor1Id,
          status: 'in_progress',
          starts_at: futureStartsAt,
          ends_at: futureEndsAt
        }]
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('marks elapsed/past slot as unavailable upon cancellation instead of available', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    const pastStarts = '2020-01-01T09:00:00.000Z';
    const pastEnds = '2020-01-01T09:30:00.000Z';

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: bookingId,
          slot_id: slotId,
          patient_id: patient1Id,
          doctor_id: doctor1Id,
          status: 'scheduled',
          starts_at: pastStarts,
          ends_at: pastEnds
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: bookingId,
          slotId,
          patientId: patient1Id,
          doctorId: doctor1Id,
          status: 'cancelled',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      })
      .mockResolvedValueOnce({ rows: [] }) // slot update
      .mockResolvedValueOnce({ rows: [] }) // audit log
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const [, slotUpdateValues] = client.query.mock.calls[3];
    expect(slotUpdateValues[0]).toBe('unavailable');
  });

  it('returns 404 BOOKING_NOT_FOUND when booking does not exist', async () => {
    const token = tokenFor(patient1Id, 'patient');
    query.mockResolvedValueOnce({
      rows: [{ id: patient1Id, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // not found
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('BOOKING_NOT_FOUND');
  });
});
