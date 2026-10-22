import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { TOTP, Secret } from 'otpauth';
import { pool } from '../../src/config/db.js';
import { env } from '../../src/config/env.js';
import { runMigrations } from '../../src/db/migrate.js';
import { processNextJob } from '../../src/jobs/worker.js';
import app from '../../src/app.js';

const database = new URL(env.DATABASE_URL).pathname.slice(1);
if (env.NODE_ENV !== 'test' || database !== process.env.PHASE4_TEST_DATABASE || !/^amrutam_phase4_test_[a-f0-9]{32}$/.test(database)) throw new Error('Disposable database required');
const password = 'Submission-test-password-123';
let doctor, patient, other, admin, consultation;
async function account(role, mfa = false) {
  const id = randomUUID(), email = `${id}@example.test`;
  await pool.query('INSERT INTO users (id,email,password_hash,role,mfa_enabled) VALUES ($1,$2,$3,$4,$5)', [id,email,await bcrypt.hash(password,4),role,mfa]);
  return { id,email, token: jwt.sign({ role,sv:0,mfa },env.JWT_SECRET,{subject:id,expiresIn:'15m'}) };
}
const authorized = (method, path, actor) => request(app)[method](path).set('Authorization',`Bearer ${actor.token}`);

beforeAll(async () => {
  await runMigrations();
  doctor = await account('doctor',true); patient = await account('patient'); other = await account('patient'); admin = await account('admin',true);
  await pool.query("INSERT INTO doctor_profiles (user_id,full_name,specialization,verification_status) VALUES ($1,'Clinical Doctor','Ayurveda','approved')",[doctor.id]);
  await pool.query("INSERT INTO patient_profiles (user_id,full_name) VALUES ($1,'Test Patient')",[patient.id]);
  const slot = (await pool.query("INSERT INTO availability_slots (doctor_id,starts_at,ends_at,status) VALUES ($1,NOW()+INTERVAL '1 day',NOW()+INTERVAL '25 hours','booked') RETURNING id",[doctor.id])).rows[0];
  consultation = (await pool.query("INSERT INTO consultations (slot_id,doctor_id,patient_id) VALUES ($1,$2,$3) RETURNING id",[slot.id,doctor.id,patient.id])).rows[0].id;
});
afterAll(async () => { await pool.end(); });

describe('Security and clinical workflows on PostgreSQL', () => {
  it('enrolls MFA, invalidates old sessions, enforces the second factor and single-use recovery', async () => {
    const actor = await account('patient');
    const enrollment = await authorized('post','/api/v1/auth/mfa/enroll',actor).send({password});
    expect(enrollment.status).toBe(200);
    const otp = new TOTP({secret:Secret.fromBase32(enrollment.body.data.secret),digits:6,period:30,algorithm:'SHA1'});
    const confirmed = await authorized('post','/api/v1/auth/mfa/confirm',actor).send({code:otp.generate()});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.recoveryCodes).toHaveLength(8);
    expect((await authorized('get','/api/v1/auth/me',actor)).status).toBe(401);
    const noFactor = await request(app).post('/api/v1/auth/login').send({email:actor.email,password});
    expect(noFactor.status).toBe(401);
    const nextCode = otp.generate({timestamp:Date.now()+30000});
    expect((await request(app).post('/api/v1/auth/login').send({email:actor.email,password,code:nextCode})).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({email:actor.email,password,code:nextCode})).status).toBe(401);
    const recoveryCode = confirmed.body.data.recoveryCodes[0];
    const login = await request(app).post('/api/v1/auth/login').send({email:actor.email,password,recoveryCode});
    expect(login.status).toBe(200);
    actor.token = login.body.data.accessToken;
    expect((await authorized('get','/api/v1/auth/me',actor)).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({email:actor.email,password,recoveryCode})).status).toBe(401);
    expect((await authorized('post','/api/v1/auth/logout-all',actor)).status).toBe(200);
    expect((await authorized('get','/api/v1/auth/me',actor)).status).toBe(401);
    const row = (await pool.query('SELECT mfa_secret,mfa_recovery_hashes FROM users WHERE id=$1',[actor.id])).rows[0];
    expect(row.mfa_secret).not.toContain(enrollment.body.data.secret);
    expect(row.mfa_recovery_hashes).not.toContain(recoveryCode);
  });

  it('denies clinical access to another patient and requires doctor MFA', async () => {
    expect((await authorized('get',`/api/v1/consultations/${consultation}`,other)).status).toBe(403);
    const unverified = await account('doctor');
    expect((await authorized('get','/api/v1/consultations/me',unverified)).body.error.code).toBe('MFA_REQUIRED');
    expect((await authorized('get',`/api/v1/consultations/${consultation}`,patient)).status).toBe(200);
  });

  it('enforces the state machine and makes repeated transitions idempotent', async () => {
    const path = `/api/v1/consultations/${consultation}/status`;
    const rxPath = `/api/v1/consultations/${consultation}/prescriptions`;
    const body = {items:[{medicationName:'Demo',instructions:'Demo',quantity:1}]};
    expect((await authorized('post',rxPath,doctor).send(body)).status).toBe(400);
    expect((await authorized('post',rxPath,doctor).set('Idempotency-Key','scheduled').send(body)).status).toBe(409);
    expect((await authorized('patch',path,doctor).send({status:'completed'})).status).toBe(409);
    expect((await authorized('patch',path,patient).send({status:'in_progress'})).status).toBe(403);
    const responses = await Promise.all([authorized('patch',path,doctor).send({status:'in_progress'}),authorized('patch',path,doctor).send({status:'in_progress'})]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    const count = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE resource_id=$1 AND action='CONSULTATION_STATUS_CHANGED'",[consultation]);
    expect(count.rows[0].n).toBe(1);
  });

  it('creates prescriptions once under concurrent retries and protects medical records', async () => {
    const path = `/api/v1/consultations/${consultation}/prescriptions`;
    const body = {items:[{medicationName:'Demo medication',instructions:'Example instructions',quantity:1}]};
    const responses = await Promise.all([1,2,3].map(()=>authorized('post',path,doctor).set('Idempotency-Key','rx-key').send(body)));
    expect(responses.map(r=>r.status)).toEqual([201,201,201]);
    expect(new Set(responses.map(r=>r.body.data.id)).size).toBe(1);
    expect((await authorized('post',path,doctor).set('Idempotency-Key','rx-key').send({...body,notes:'changed'})).status).toBe(409);
    expect((await authorized('post',path,patient).set('Idempotency-Key','bad').send(body)).status).toBe(403);
    expect((await authorized('get',path,other)).status).toBe(403);
    expect((await authorized('get',path,patient)).body.data).toHaveLength(1);
    expect((await authorized('patch',`/api/v1/consultations/${consultation}/status`,doctor).send({status:'completed'})).status).toBe(200);
    expect((await authorized('patch',`/api/v1/consultations/${consultation}/status`,doctor).send({status:'in_progress'})).status).toBe(409);
  });

  it('restricts analytics and metrics to MFA-authenticated admins', async () => {
    expect((await authorized('get','/api/v1/admin/analytics',patient)).status).toBe(403);
    const result = await authorized('get','/api/v1/admin/analytics',admin);
    expect(result.status).toBe(200); expect(result.body.data.total).toBeGreaterThan(0);
    const metrics = await authorized('get','/api/v1/admin/metrics',admin);
    expect(metrics.status).toBe(200); expect(metrics.text).toContain('amrutam_http_requests_total');
  });

  it('processes asynchronous analytics jobs idempotently', async () => {
    let processed = 0;
    while (await processNextJob()) { if (++processed > 100) throw new Error('Unexpected job backlog'); }
    expect(processed).toBeGreaterThan(0);
    expect(await processNextJob()).toBe(false);
    const snapshot = await pool.query('SELECT data FROM analytics_snapshots WHERE id=1');
    expect(snapshot.rows[0].data.completed).toBeGreaterThan(0);
  });
});
