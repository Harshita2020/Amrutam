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

const doctor1Id = '89d214bb-68aa-4b04-95bf-123bd69da4a8';
const doctor2Id = '99d214bb-68aa-4b04-95bf-123bd69da4a9';
const patientId = '79d214bb-68aa-4b04-95bf-123bd69da4a7';
const slotId = '11d214bb-68aa-4b04-95bf-123bd69da411';

function tokenFor(userId, role = 'doctor') {
  return jwt.sign({ role }, env.JWT_SECRET, { algorithm: 'HS256', subject: userId, expiresIn: '15m' });
}

beforeEach(() => {
  query.mockReset();
  client.query.mockReset();
  client.release.mockReset();
});

describe('POST /api/v1/doctors/me/slots (Create Availability Slot)', () => {
  const futureStartsAt = new Date(Date.now() + 86400000).toISOString(); // +1 day
  const futureEndsAt = new Date(Date.now() + 86400000 + 1800000).toISOString(); // +30 mins

  it('allows an authenticated doctor to create a valid future availability slot', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr.aisha@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: doctor1Id }] }) // Doctor profile check & lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // Overlap check
      .mockResolvedValueOnce({
        rows: [{
          id: slotId,
          doctorId: doctor1Id,
          startsAt: futureStartsAt,
          endsAt: futureEndsAt,
          status: 'available',
          createdAt: new Date().toISOString()
        }]
      }) // Insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .post('/api/v1/doctors/me/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ startsAt: futureStartsAt, endsAt: futureEndsAt });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(slotId);
    expect(response.body.data.doctorId).toBe(doctor1Id);
    expect(response.body.data.status).toBe('available');
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects slot creation if endsAt is earlier than or equal to startsAt', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    const response = await request(app)
      .post('/api/v1/doctors/me/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ startsAt: futureEndsAt, endsAt: futureStartsAt });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rejects slots scheduled in the past', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    const pastStartsAt = '2020-01-01T09:00:00.000Z';
    const pastEndsAt = '2020-01-01T09:30:00.000Z';

    const response = await request(app)
      .post('/api/v1/doctors/me/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ startsAt: pastStartsAt, endsAt: pastEndsAt });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('future');
  });

  it('rejects overlapping slots for the same doctor with 409 SLOT_OVERLAP', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: doctor1Id }] }) // Doctor profile check & lock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'existing-slot-uuid' }] }) // Overlap check returns match
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .post('/api/v1/doctors/me/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ startsAt: futureStartsAt, endsAt: futureEndsAt });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SLOT_OVERLAP');
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects patient attempts to create slots with 403 FORBIDDEN', async () => {
    const token = tokenFor(patientId, 'patient');

    query.mockResolvedValueOnce({
      rows: [{ id: patientId, email: 'p@example.com', role: 'patient', is_active: true }]
    });

    const response = await request(app)
      .post('/api/v1/doctors/me/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ startsAt: futureStartsAt, endsAt: futureEndsAt });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});

describe('PATCH /api/v1/doctors/me/slots/:slotId (Update Slot)', () => {
  const futureStartsAt = new Date(Date.now() + 86400000).toISOString();
  const futureEndsAt = new Date(Date.now() + 86400000 + 1800000).toISOString();

  it('allows owning doctor to update an unbooked slot status', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // Doctor overlap lock
      .mockResolvedValueOnce({
        rows: [{ id: slotId, doctor_id: doctor1Id, starts_at: futureStartsAt, ends_at: futureEndsAt, status: 'available' }]
      }) // Select slot for update
      .mockResolvedValueOnce({
        rows: [{
          id: slotId,
          doctorId: doctor1Id,
          startsAt: futureStartsAt,
          endsAt: futureEndsAt,
          status: 'unavailable',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      }) // Update
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .patch(`/api/v1/doctors/me/slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'unavailable' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('unavailable');
  });

  it('allows owning doctor to update slot timings with overlap validation', async () => {
    const token = tokenFor(doctor1Id, 'doctor');
    const newStarts = new Date(Date.now() + 90000000).toISOString();
    const newEnds = new Date(Date.now() + 90000000 + 1800000).toISOString();

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // Doctor overlap lock
      .mockResolvedValueOnce({
        rows: [{ id: slotId, doctor_id: doctor1Id, starts_at: futureStartsAt, ends_at: futureEndsAt, status: 'available' }]
      }) // Select slot for update
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // No consultation history
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // Overlap check
      .mockResolvedValueOnce({
        rows: [{
          id: slotId,
          doctorId: doctor1Id,
          startsAt: newStarts,
          endsAt: newEnds,
          status: 'available',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      }) // Update
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .patch(`/api/v1/doctors/me/slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startsAt: newStarts, endsAt: newEnds });

    expect(response.status).toBe(200);
    expect(response.body.data.startsAt).toBe(newStarts);
  });

  it('prevents doctor A from updating doctor B slot with 403 FORBIDDEN', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr1@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // Doctor overlap lock
      .mockResolvedValueOnce({
        rows: [{ id: slotId, doctor_id: doctor2Id, starts_at: futureStartsAt, ends_at: futureEndsAt, status: 'available' }]
      }) // slot belongs to doctor2
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .patch(`/api/v1/doctors/me/slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'unavailable' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects updates to an already booked slot with 409 SLOT_ALREADY_BOOKED', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // Doctor overlap lock
      .mockResolvedValueOnce({
        rows: [{ id: slotId, doctor_id: doctor1Id, starts_at: futureStartsAt, ends_at: futureEndsAt, status: 'booked' }]
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .patch(`/api/v1/doctors/me/slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'unavailable' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SLOT_ALREADY_BOOKED');
  });
});

describe('DELETE /api/v1/doctors/me/slots/:slotId (Delete Slot)', () => {
  it('allows owning doctor to delete an unbooked, unreferenced slot', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: slotId, doctor_id: doctor1Id, status: 'available' }] }) // Slot check
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // Consultation check
      .mockResolvedValueOnce({ rows: [] }) // DELETE
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .delete(`/api/v1/doctors/me/slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: slotId, deleted: true });
  });

  it('prevents doctor A from deleting doctor B slot with 403 FORBIDDEN', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: slotId, doctor_id: doctor2Id, status: 'available' }] })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .delete(`/api/v1/doctors/me/slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects deletion of a slot referenced by a consultation with 409 SLOT_REFERENCED', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: slotId, doctor_id: doctor1Id, status: 'available' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'consultation-uuid' }] }) // Consultation exists!
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .delete(`/api/v1/doctors/me/slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SLOT_REFERENCED');
  });

  it('returns 404 SLOT_NOT_FOUND when trying to delete a non-existent slot', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // Not found
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const response = await request(app)
      .delete(`/api/v1/doctors/me/slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('SLOT_NOT_FOUND');
  });
});

describe('GET /api/v1/doctors/:doctorId/slots (List Available Slots)', () => {
  it('returns available, future slots for an approved, active doctor', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: doctor1Id }] }) // Doctor approved check
      .mockResolvedValueOnce({
        rows: [{
          id: slotId,
          doctorId: doctor1Id,
          startsAt: '2026-10-25T09:00:00.000Z',
          endsAt: '2026-10-25T09:30:00.000Z',
          status: 'available',
          createdAt: '2026-10-22T10:00:00.000Z'
        }]
      }); // Slots query

    const response = await request(app).get(`/api/v1/doctors/${doctor1Id}/slots`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].status).toBe('available');

    const [sql] = query.mock.calls[1];
    expect(sql).toContain("status = 'available'");
    expect(sql).toContain('starts_at >= NOW()');
  });

  it('returns 404 DOCTOR_NOT_FOUND if doctor is not discoverable', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const response = await request(app).get(`/api/v1/doctors/${doctor1Id}/slots`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('DOCTOR_NOT_FOUND');
  });
});
