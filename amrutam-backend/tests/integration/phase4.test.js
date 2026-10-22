import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import app from '../../src/app.js';
import { pool } from '../../src/config/db.js';
import { env } from '../../src/config/env.js';
import { runMigrations } from '../../src/db/migrate.js';

const database = new URL(env.DATABASE_URL).pathname.slice(1);
if (env.NODE_ENV !== 'test' || database !== process.env.PHASE4_TEST_DATABASE ||
    !/^amrutam_phase4_test_[a-f0-9]{32}$/.test(database)) {
  throw new Error('Run with npm run test:integration; fixtures require a disposable database.');
}

let doctor, patient, other, admin;
const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
async function user(role) {
  const id = randomUUID();
  await pool.query('INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)',
    [id, `${id}@example.test`, 'unused-test-hash', role]);
  return { id, token: jwt.sign({ role }, env.JWT_SECRET, { subject: id, expiresIn: '15m' }) };
}
async function slot(hours = 24, status = 'available') {
  const result = await pool.query(
    `INSERT INTO availability_slots (doctor_id,starts_at,ends_at,status)
     VALUES ($1,$2,$3,$4) RETURNING id`, [doctor.id, future(hours), future(hours + 0.5), status]);
  return result.rows[0].id;
}
function book(id, actor = patient, key) {
  const req = request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${actor.token}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send({ slotId: id });
}
function cancel(id, actor = patient) {
  return request(app).post(`/api/v1/bookings/${id}/cancel`)
    .set('Authorization', `Bearer ${actor.token}`).send({ reason: 'Schedule change' });
}
async function state(id) {
  return (await pool.query(`SELECT s.status,
    (SELECT count(*)::int FROM consultations c WHERE c.slot_id=s.id AND c.status!='cancelled') AS active,
    (SELECT count(*)::int FROM audit_logs a JOIN consultations c ON a.resource_id=c.id::text
     WHERE c.slot_id=s.id AND a.action='BOOKING_CREATED') AS created
    FROM availability_slots s WHERE s.id=$1`, [id])).rows[0];
}

beforeAll(async () => {
  await runMigrations();
  expect(await runMigrations()).toEqual([]);
  doctor = await user('doctor');
  patient = await user('patient');
  other = await user('patient');
  admin = await user('admin');
  await pool.query(`INSERT INTO doctor_profiles (user_id,full_name,specialization,verification_status)
    VALUES ($1,'Test Doctor','Ayurveda','approved')`, [doctor.id]);
});
afterAll(async () => { await pool.end(); });

describe('Phase 4 against real PostgreSQL', () => {
  it('repairs partially applied migration 004 instead of incorrectly baselining it', async () => {
    await pool.query("DELETE FROM schema_migrations WHERE name='004_booking_and_cancellations.sql'");
    await pool.query('DROP INDEX idx_consultations_patient_status');
    expect(await runMigrations()).toEqual(['004_booking_and_cancellations.sql']);
    expect(await runMigrations()).toEqual([]);
  });

  it('allows only one patient to win simultaneous requests for the same slot', async () => {
    const id = await slot(24);
    const responses = await Promise.all([book(id), book(id, other)]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await state(id)).toEqual({ status: 'booked', active: 1, created: 1 });
  });

  it('replays identical concurrent requests with one consultation and one audit event', async () => {
    const id = await slot(26);
    const responses = await Promise.all(Array.from({ length: 5 }, () => book(id, patient, 'same-key')));
    expect(responses.map(r => r.status)).toEqual([201, 201, 201, 201, 201]);
    for (const response of responses) expect(response.body).toEqual(responses[0].body);
    expect((await book(id.toUpperCase(), patient, 'same-key')).body).toEqual(responses[0].body);
    expect(await state(id)).toEqual({ status: 'booked', active: 1, created: 1 });
  });

  it('rejects simultaneous key reuse with a different slot and rolls back the losing slot', async () => {
    const ids = [await slot(28), await slot(30)];
    const responses = await Promise.all(ids.map(id => book(id, patient, 'different-payload')));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const loser = responses.findIndex(r => r.status === 409);
    expect(responses[loser].body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await state(ids[loser])).toEqual({ status: 'available', active: 0, created: 0 });
  });

  it('scopes keys to patients', async () => {
    const a = await book(await slot(32), patient, 'shared');
    const b = await book(await slot(34), other, 'shared');
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });

  it('cancels once, rebooks a released slot, and replays the original creation after cancellation', async () => {
    const id = await slot(36);
    const original = await book(id, patient, 'cancel-and-replay');
    const cancellations = await Promise.all([cancel(original.body.data.id), cancel(original.body.data.id)]);
    expect(cancellations.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await state(id)).status).toBe('available');
    const replacement = await book(id, other, 'replacement');
    expect(replacement.status).toBe(201);
    const replay = await book(id, patient, 'cancel-and-replay');
    expect(replay.body).toEqual(original.body);
    expect(await state(id)).toEqual({ status: 'booked', active: 1, created: 2 });
    const audit = await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE resource_id=$1 AND action='BOOKING_CANCELLED'", [original.body.data.id]);
    expect(audit.rows[0].count).toBe(1);
  });

  it('enforces patient ownership and permits assigned doctor/admin access', async () => {
    const booking = await book(await slot(38));
    const id = booking.body.data.id;
    for (const [actor, status] of [[patient, 200], [doctor, 200], [admin, 200], [other, 403]]) {
      const response = await request(app).get(`/api/v1/bookings/${id}`).set('Authorization', `Bearer ${actor.token}`);
      expect(response.status).toBe(status);
    }
    expect((await cancel(id, other)).status).toBe(403);
    expect((await cancel(id, admin)).status).toBe(200);
  });

  it('keeps cancelled appointment times intact when a doctor tries to edit the released slot', async () => {
    const id = await slot(48);
    const original = await book(id);
    expect((await cancel(original.body.data.id)).status).toBe(200);
    const response = await request(app).patch(`/api/v1/doctors/me/slots/${id}`)
      .set('Authorization', `Bearer ${doctor.token}`).send({ startsAt: future(49), endsAt: future(49.5) });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SLOT_REFERENCED');
  });

  it('paginates bookings without losing PostgreSQL microsecond timestamps', async () => {
    const actor = await user('patient');
    const a = await book(await slot(50), actor);
    const b = await book(await slot(52), actor);
    await pool.query("UPDATE consultations SET created_at='2026-10-22T12:00:00.123456Z' WHERE id=$1", [a.body.data.id]);
    await pool.query("UPDATE consultations SET created_at='2026-10-22T12:00:00.123455Z' WHERE id=$1", [b.body.data.id]);
    const first = await request(app).get('/api/v1/bookings/me?limit=1').set('Authorization', `Bearer ${actor.token}`);
    expect(first.status).toBe(200);
    expect(first.body.data[0].id).toBe(a.body.data.id);
    expect(first.body.data[0]).not.toHaveProperty('cursorCreatedAt');
    const second = await request(app).get('/api/v1/bookings/me').query({ limit: 1, cursor: first.body.pagination.nextCursor })
      .set('Authorization', `Bearer ${actor.token}`);
    expect(second.status).toBe(200);
    expect(second.body.data[0].id).toBe(b.body.data.id);
    expect(second.body.pagination.nextCursor).toBeNull();
  });

  it('rolls back cancellation and slot release when its audit write fails', async () => {
    const id = await slot(54);
    const original = await book(id);
    await pool.query(`CREATE FUNCTION reject_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='BOOKING_CANCELLED' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_cancel_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_cancel_audit()`);
    try {
      expect((await cancel(original.body.data.id)).status).toBe(500);
      expect(await state(id)).toEqual({ status: 'booked', active: 1, created: 1 });
    } finally {
      await pool.query('DROP TRIGGER reject_cancel_audit ON audit_logs; DROP FUNCTION reject_cancel_audit()');
    }
  });

  it('rolls back consultation and reservation if the audit write fails', async () => {
    const id = await slot(40);
    await pool.query(`CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
      CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_test_audit()`);
    try {
      expect((await book(id)).status).toBe(500);
      expect(await state(id)).toEqual({ status: 'available', active: 0, created: 0 });
    } finally {
      await pool.query('DROP TRIGGER reject_test_audit ON audit_logs; DROP FUNCTION reject_test_audit()');
    }
  });

  it('serializes overlapping slot creation and update with the same doctor lock', async () => {
    const id = await slot(42);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT user_id FROM doctor_profiles WHERE user_id=$1 FOR UPDATE', [doctor.id]);
      const update = request(app).patch(`/api/v1/doctors/me/slots/${id}`)
        .set('Authorization', `Bearer ${doctor.token}`).send({ startsAt: future(44), endsAt: future(45) }).then(r => r);
      const create = request(app).post('/api/v1/doctors/me/slots')
        .set('Authorization', `Bearer ${doctor.token}`).send({ startsAt: future(44.5), endsAt: future(45.5) }).then(r => r);
      // Wait for both SQL sessions to block, not an arbitrary timing assumption.
      const deadline = Date.now() + 5000;
      let waiting = 0;
      while (Date.now() < deadline) {
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const result = await blocker.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'`);
        waiting = result.rows[0].n;
        if (waiting >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await blocker.query('COMMIT');
      const responses = await Promise.all([update, create]);
      expect(waiting).toBeGreaterThanOrEqual(2);
      expect(responses.filter(r => r.status === 409)).toHaveLength(1);
      expect(responses.filter(r => [200, 201].includes(r.status))).toHaveLength(1);
      const overlaps = await pool.query(`SELECT count(*)::int AS n FROM availability_slots a
        JOIN availability_slots b ON a.doctor_id=b.doctor_id AND a.id<b.id
        AND a.starts_at<b.ends_at AND a.ends_at>b.starts_at
        WHERE a.status!='unavailable' AND b.status!='unavailable'`);
      expect(overlaps.rows[0].n).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  });
});
