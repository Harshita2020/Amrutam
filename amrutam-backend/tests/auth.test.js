import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { requireRole } from '../src/middleware/authorize.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/config/db.js', () => ({ pool: { query } }));

const userId = '89d214bb-68aa-4b04-95bf-123bd69da4a8';
const password = 'A-strong-password-123';
const passwordHash = await bcrypt.hash(password, 4);
const user = {
  id: userId,
  email: 'person@example.com',
  password_hash: passwordHash,
  role: 'patient',
  is_active: true
};

function tokenFor(claims = { role: 'patient' }, options = { subject: userId, expiresIn: '15m' }) {
  return jwt.sign(claims, env.JWT_SECRET, { algorithm: 'HS256', ...options });
}

beforeEach(() => {
  query.mockReset();
});

describe('POST /api/v1/auth/register', () => {
  it.each(['patient', 'doctor'])('registers a %s with a hashed password and safe response', async (role) => {
    query.mockResolvedValueOnce({
      rows: [{ id: userId, email: 'person@example.com', role, is_active: true }]
    });

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: ' Person@Example.com ', password, role });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({
      id: userId,
      email: 'person@example.com',
      role,
      isActive: true
    });
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(JSON.stringify(response.body)).not.toContain('password_hash');
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO users');
    expect(values[0]).toBe('person@example.com');
    expect(values[2]).toBe(role);
    expect(values[1]).not.toBe(password);
    expect(await bcrypt.compare(password, values[1])).toBe(true);
  });

  it('rejects duplicate normalized emails without exposing database details', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('duplicate key: internal detail'), { code: '23505' }));

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: ' Person@Example.com ', password, role: 'patient' });

    expect(response.status).toBe(409);
    expect(response.body.error).toEqual({
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'An account with this email already exists'
    });
    expect(JSON.stringify(response.body)).not.toContain('internal detail');
    expect(query.mock.calls[0][1][0]).toBe('person@example.com');
  });

  it.each([
    [{ password, role: 'patient' }],
    [{ email: 'not-an-email', password, role: 'patient' }],
    [{ email: 'person@example.com', role: 'patient' }],
    [{ email: 'person@example.com', password: 'short', role: 'patient' }],
    [{ email: 'person@example.com', password, role: 'admin' }],
    [{ email: 'person@example.com', password, role: 'unknown' }],
    [{ email: 'person@example.com', password }],
    [{ email: 'person@example.com', password, role: 'patient', userId }]
  ])('rejects invalid, privileged, or unexpected registration fields', async (body) => {
    const response = await request(app).post('/api/v1/auth/register').send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/login', () => {
  it('issues an expiring signed token with only identity claims', async () => {
    query.mockResolvedValueOnce({ rows: [user] });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ' PERSON@EXAMPLE.COM ', password });

    expect(response.status).toBe(200);
    expect(response.body.data.tokenType).toBe('Bearer');
    expect(response.body.data.expiresIn).toBe(900);
    expect(response.body.data.user).toEqual({
      id: userId,
      email: user.email,
      role: user.role
    });
    const claims = jwt.verify(response.body.data.accessToken, env.JWT_SECRET, { algorithms: ['HS256'] });
    expect(claims.sub).toBe(userId);
    expect(claims.role).toBe('patient');
    expect(claims.exp - claims.iat).toBe(900);
    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('password');
    expect(claims).not.toHaveProperty('password_hash');
    expect(query.mock.calls[0][1]).toEqual(['person@example.com']);
  });

  it('uses the same generic error for unknown email and incorrect password', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...user, password_hash: passwordHash }] });

    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'unknown@example.com', password });
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Wrong-password-123' });

    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.body).toEqual(wrongPassword.body);
    expect(unknownUser.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the database-backed identity and ignores identity fields in the request body', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...user, role: 'patient' }] });

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      id: userId,
      email: user.email,
      role: 'patient',
      isActive: true
    });
    expect(query.mock.calls[0][1]).toEqual([userId]);
  });

  it.each([
    ['missing authorization', undefined],
    ['malformed authorization', 'Basic abc'],
    ['invalid token', 'Bearer not-a-token'],
    ['invalid signature', `Bearer ${jwt.sign({ role: 'patient' }, 'another-signing-secret', { algorithm: 'HS256', subject: userId, expiresIn: '15m' })}`],
    ['expired token', `Bearer ${tokenFor({ role: 'patient' }, { subject: userId, expiresIn: -1 })}`],
    ['token without expiry', `Bearer ${jwt.sign({ role: 'patient' }, env.JWT_SECRET, { algorithm: 'HS256', subject: userId })}`],
    ['token with invalid claims', `Bearer ${tokenFor({ role: 'admin', userId }, { subject: userId, expiresIn: '15m' })}`]
  ])('rejects %s with 401', async (_case, authorization) => {
    const requestBuilder = request(app).get('/api/v1/auth/me');
    if (authorization) requestBuilder.set('Authorization', authorization);
    const response = await requestBuilder;

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects inactive accounts and stale role claims', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...user, is_active: false }] });
    const inactive = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor()}`);
    query.mockResolvedValueOnce({ rows: [{ ...user, role: 'doctor' }] });
    const changedRole = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(inactive.status).toBe(401);
    expect(changedRole.status).toBe(401);
  });

  it('returns a safe generic error when the database fails', async () => {
    query.mockRejectedValueOnce(new Error('SQL error with private detail'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred'
    });
    expect(JSON.stringify(response.body)).not.toContain('private detail');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private detail');
    log.mockRestore();
  });
});

describe('role authorization middleware', () => {
  it('allows permitted roles and rejects missing or disallowed identities', async () => {
    const invoke = (middleware, req) => new Promise((resolve) => {
      middleware(req, {}, (error) => resolve(error));
    });

    expect(await invoke(requireRole('doctor'), { auth: { role: 'doctor' } })).toBeUndefined();
    expect((await invoke(requireRole('doctor'), { auth: { role: 'patient' } })).statusCode).toBe(403);
    expect((await invoke(requireRole('doctor'), {})).statusCode).toBe(401);
  });
});

describe('malformed request bodies', () => {
  it('returns a validation error for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
