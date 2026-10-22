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

function tokenFor(userId, role = 'doctor') {
  return jwt.sign({ role }, env.JWT_SECRET, { algorithm: 'HS256', subject: userId, expiresIn: '15m' });
}

beforeEach(() => {
  query.mockReset();
  client.query.mockReset();
  client.release.mockReset();
});

describe('GET /api/v1/doctors (Doctor Discovery & Search)', () => {
  it('returns a list of discoverable doctors with safe public fields and pagination', async () => {
    const doctorRows = [
      {
        id: doctor1Id,
        fullName: 'Dr. Aisha Sharma',
        specialty: 'Ayurvedic Medicine',
        specialization: 'Ayurvedic Medicine',
        bio: 'Expert in herbal medicine and wellness',
        createdAt: '2026-10-22T10:00:00.000Z'
      }
    ];

    query.mockResolvedValueOnce({ rows: doctorRows });

    const response = await request(app).get('/api/v1/doctors?limit=10');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(doctorRows[0]);
    expect(response.body.pagination).toEqual({ limit: 10, nextCursor: null });

    const [sql] = query.mock.calls[0];
    expect(sql).toContain("dp.verification_status = 'approved'");
    expect(sql).toContain('u.is_active = TRUE');
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(JSON.stringify(response.body)).not.toContain('verification_status');
  });

  it('filters doctors by specialty / specialization', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get('/api/v1/doctors?specialty=Ayurveda');

    expect(response.status).toBe(200);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('LOWER(dp.specialization) = $1');
    expect(values[0]).toBe('ayurveda');
  });

  it('searches doctors by q parameter across name, specialization, and bio', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get('/api/v1/doctors?q=herbal');

    expect(response.status).toBe(200);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('dp.full_name ILIKE $1 OR dp.specialization ILIKE $1 OR COALESCE(dp.bio, \'\') ILIKE $1');
    expect(values[0]).toBe('%herbal%');
  });

  it('rejects unexpected query parameters to prevent SQL injection or unvalidated filters', async () => {
    const response = await request(app).get('/api/v1/doctors?role=admin');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects invalid limit values', async () => {
    const response = await request(app).get('/api/v1/doctors?limit=999');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('supports cursor-based pagination and encodes nextCursor when more items exist', async () => {
    const rows = [
      { id: doctor1Id, fullName: 'Dr. One', specialty: 'Ayurveda', specialization: 'Ayurveda', bio: null, createdAt: new Date('2026-10-22T10:00:00Z') },
      { id: doctor2Id, fullName: 'Dr. Two', specialty: 'Panchakarma', specialization: 'Panchakarma', bio: null, createdAt: new Date('2026-10-22T09:00:00Z') }
    ];

    query.mockResolvedValueOnce({ rows });

    const response = await request(app).get('/api/v1/doctors?limit=1');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination.limit).toBe(1);
    expect(response.body.pagination.nextCursor).toBeTruthy();

    const decoded = JSON.parse(Buffer.from(response.body.pagination.nextCursor, 'base64').toString('utf8'));
    expect(decoded.id).toBe(doctor1Id);
  });

  it('rejects malformed pagination cursor', async () => {
    const response = await request(app).get('/api/v1/doctors?cursor=invalid-not-base64-json');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/doctors/:doctorId (Public Doctor Profile)', () => {
  it('returns a public doctor profile for an approved, active doctor', async () => {
    const doctor = {
      id: doctor1Id,
      fullName: 'Dr. Aisha Sharma',
      specialty: 'Ayurvedic Medicine',
      specialization: 'Ayurvedic Medicine',
      bio: 'Expert holistic practitioner',
      createdAt: '2026-10-22T10:00:00.000Z'
    };

    query.mockResolvedValueOnce({ rows: [doctor] });

    const response = await request(app).get(`/api/v1/doctors/${doctor1Id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(doctor);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("dp.verification_status = 'approved'");
    expect(sql).toContain('u.is_active = TRUE');
  });

  it('returns 404 DOCTOR_NOT_FOUND if doctor does not exist, is inactive, or not approved', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get(`/api/v1/doctors/${doctor1Id}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('DOCTOR_NOT_FOUND');
  });

  it('returns 400 INVALID_ID if doctorId is not a valid UUID', async () => {
    const response = await request(app).get('/api/v1/doctors/not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ID');
    expect(query).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/doctors/me (Doctor Profile Update)', () => {
  it('allows authenticated doctor to update permitted fields on their own profile', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    // 1. authenticate middleware user check
    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr.aisha@example.com', role: 'doctor', is_active: true }]
    });
    // 2. existing profile lookup
    query.mockResolvedValueOnce({
      rows: [{ user_id: doctor1Id, full_name: 'Dr. Aisha', specialization: 'Ayurveda', bio: 'Old bio' }]
    });
    // 3. update query
    query.mockResolvedValueOnce({
      rows: [{
        id: doctor1Id,
        fullName: 'Dr. Aisha Sharma',
        specialty: 'Clinical Ayurveda',
        specialization: 'Clinical Ayurveda',
        bio: 'Updated bio',
        createdAt: '2026-10-22T10:00:00.000Z',
        updatedAt: '2026-10-22T11:00:00.000Z'
      }]
    });

    const response = await request(app)
      .patch('/api/v1/doctors/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Dr. Aisha Sharma',
        specialty: 'Clinical Ayurveda',
        bio: 'Updated bio'
      });

    expect(response.status).toBe(200);
    expect(response.body.data.fullName).toBe('Dr. Aisha Sharma');
    expect(response.body.data.specialty).toBe('Clinical Ayurveda');
    expect(response.body.data.bio).toBe('Updated bio');

    const [updateSql, updateValues] = query.mock.calls[2];
    expect(updateSql).toContain('UPDATE doctor_profiles');
    expect(updateValues[0]).toBe('Dr. Aisha Sharma');
    expect(updateValues[1]).toBe('Clinical Ayurveda');
    expect(updateValues[2]).toBe('Updated bio');
    expect(updateValues[3]).toBe(doctor1Id);
  });

  it('rejects patient attempts to update a doctor profile with 403 FORBIDDEN', async () => {
    const token = tokenFor(patientId, 'patient');

    query.mockResolvedValueOnce({
      rows: [{ id: patientId, email: 'patient@example.com', role: 'patient', is_active: true }]
    });

    const response = await request(app)
      .patch('/api/v1/doctors/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Dr. Fake' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects unauthenticated requests with 401 UNAUTHENTICATED', async () => {
    const response = await request(app)
      .patch('/api/v1/doctors/me')
      .send({ fullName: 'Dr. Unauthenticated' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each([
    { role: 'admin' },
    { userId: doctor2Id },
    { verificationStatus: 'approved' },
    { verification_status: 'approved' },
    { is_active: true },
    { email: 'hacked@example.com' },
    { password: 'new-password' }
  ])('rejects attempts to modify privileged or unsupported field %j', async (badField) => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    const response = await request(app)
      .patch('/api/v1/doctors/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Valid Name', ...badField });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects empty update payloads', async () => {
    const token = tokenFor(doctor1Id, 'doctor');

    query.mockResolvedValueOnce({
      rows: [{ id: doctor1Id, email: 'dr@example.com', role: 'doctor', is_active: true }]
    });

    const response = await request(app)
      .patch('/api/v1/doctors/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
