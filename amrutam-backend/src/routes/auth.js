import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { httpError } from '../utils/http-error.js';
import { transaction, audit } from '../db/transaction.js';
import { createMfaService } from '../services/mfa.js';
import { authLimiter } from '../middleware/security.js';
import { password as passwordSchema, code as codeSchema } from '../utils/validation.js';

const router = Router();
const mfa = createMfaService(env.MFA_ENCRYPTION_KEY);
const dummyPasswordHash = bcrypt.hashSync('not-a-real-account', 12);
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(12).max(72).refine((password) => Buffer.byteLength(password, 'utf8') <= 72),
  role: z.enum(['patient', 'doctor'])
}).strict();
const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  code: codeSchema.optional(),
  recoveryCode: z.string().regex(/^[a-f0-9]{32}$/).optional()
}).strict();

function parseRequest(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw httpError(400, 'VALIDATION_ERROR', 'Request validation failed');
  }
  return parsed.data;
}

function durationInSeconds(duration) {
  const amount = Number.parseInt(duration, 10);
  const unit = duration.at(-1);
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return amount * multiplier;
}

router.post('/register', authLimiter, async (req, res) => {
  const { email, password, role } = parseRequest(registerSchema, req.body);
  const passwordHash = await bcrypt.hash(password, 12);

  let result;
  try {
    result = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, email, role, is_active`,
      [email, passwordHash, role]
    );
  } catch (error) {
    if (error.code === '23505') {
      throw httpError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
    }
    throw error;
  }

  const user = result.rows[0];
  await audit(pool, user.id, 'USER_REGISTERED', 'user', user.id);
  res.status(201).json({
    data: {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.is_active
    }
  });
});

router.post('/login', authLimiter, async (req, res) => {
  const { email, password, code, recoveryCode } = parseRequest(loginSchema, req.body);
  const result = await pool.query(
    `SELECT id, email, password_hash, role, is_active, mfa_enabled, session_version
     FROM users
     WHERE lower(btrim(email)) = $1`,
    [email]
  );
  const user = result.rows[0];
  const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? dummyPasswordHash);

  if (!user || !user.is_active || !passwordMatches) {
    await audit(pool, user?.id ?? null, 'AUTH_LOGIN_FAILED', 'user', user?.id ?? null);
    throw httpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  let verifiedMfa = false;
  if (user.mfa_enabled) {
    try { await transaction(pool, async client => {
      const current = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [user.id])).rows[0];
      if (!current.is_active || current.session_version !== user.session_version || current.password_hash !== user.password_hash) {
        throw httpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }
      if (recoveryCode) {
        const remaining = mfa.consumeRecovery(current.mfa_recovery_hashes, recoveryCode);
        if (!remaining) throw httpError(401, 'INVALID_MFA', 'MFA code is invalid or already used');
        await client.query('UPDATE users SET mfa_recovery_hashes=$1 WHERE id=$2', [JSON.stringify(remaining), user.id]);
      } else {
        const step = mfa.verify(current.mfa_secret, user.id, code, current.mfa_last_step);
        if (step === null) throw httpError(401, 'MFA_REQUIRED', 'A valid unused authenticator code or recovery code is required');
        await client.query('UPDATE users SET mfa_last_step=$1 WHERE id=$2', [step, user.id]);
      }
      await audit(client, user.id, 'MFA_LOGIN', 'user', user.id);
    }); } catch (error) {
      await audit(pool, user.id, 'AUTH_MFA_FAILED', 'user', user.id);
      throw error;
    }
    verifiedMfa = true;
  }
  await audit(pool, user.id, 'AUTH_LOGIN_SUCCEEDED', 'user', user.id);

  const accessToken = jwt.sign(
    { role: user.role, sv: user.session_version ?? 0, mfa: verifiedMfa },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      subject: user.id,
      expiresIn: env.JWT_EXPIRES_IN
    }
  );

  res.status(200).json({
    data: {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: durationInSeconds(env.JWT_EXPIRES_IN),
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    }
  });
});

router.post('/mfa/enroll', authLimiter, authenticate, async (req, res) => {
  const { password } = parseRequest(z.object({ password: passwordSchema }).strict(), req.body);
  const result = await transaction(pool, async client => {
    const user = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.auth.userId])).rows[0];
    if (!await bcrypt.compare(password, user.password_hash)) throw httpError(401, 'INVALID_CREDENTIALS', 'Credentials are incorrect');
    if (user.mfa_enabled) throw httpError(409, 'MFA_ALREADY_ENABLED', 'MFA is already enabled');
    const enrollment = mfa.enroll(user.id, user.email);
    await client.query(`UPDATE users SET mfa_pending_secret=$1, mfa_pending_expires_at=NOW()+INTERVAL '10 minutes'
      WHERE id=$2`, [enrollment.encrypted, user.id]);
    await audit(client, user.id, 'MFA_ENROLLMENT_STARTED', 'user', user.id);
    return { secret: enrollment.secret, otpauthUri: enrollment.otpauthUri, expiresIn: 600 };
  });
  res.set('Cache-Control', 'no-store').json({ data: result });
});

router.post('/mfa/confirm', authLimiter, authenticate, async (req, res) => {
  const { code } = parseRequest(z.object({ code: codeSchema }).strict(), req.body);
  const result = await transaction(pool, async client => {
    const user = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.auth.userId])).rows[0];
    if (user.mfa_enabled) throw httpError(409, 'MFA_ALREADY_ENABLED', 'MFA is already enabled');
    if (!user.mfa_pending_expires_at || new Date(user.mfa_pending_expires_at) <= new Date()) {
      throw httpError(400, 'MFA_ENROLLMENT_EXPIRED', 'Start MFA enrollment again');
    }
    const step = mfa.verify(user.mfa_pending_secret, user.id, code, -1);
    if (step === null) throw httpError(401, 'INVALID_MFA', 'MFA code is invalid');
    const recovery = mfa.recoveryCodes();
    await client.query(`UPDATE users SET mfa_secret=mfa_pending_secret, mfa_pending_secret=NULL,
      mfa_pending_expires_at=NULL, mfa_enabled=TRUE, mfa_last_step=$1,
      mfa_recovery_hashes=$2, session_version=session_version+1 WHERE id=$3`,
      [step, JSON.stringify(recovery.hashes), user.id]);
    await audit(client, user.id, 'MFA_ENABLED', 'user', user.id);
    return { enabled: true, recoveryCodes: recovery.codes, loginRequired: true };
  });
  res.set('Cache-Control', 'no-store').json({ data: result });
});

router.post('/logout-all', authenticate, async (req, res) => {
  await transaction(pool, async client => {
    await client.query('UPDATE users SET session_version=session_version+1 WHERE id=$1', [req.auth.userId]);
    await audit(client, req.auth.userId, 'SESSIONS_REVOKED', 'user', req.auth.userId);
  });
  res.json({ data: { revoked: true } });
});

router.get('/me', authenticate, (req, res) => {
  res.status(200).json({
    data: {
      id: req.auth.userId,
      email: req.auth.email,
      role: req.auth.role,
      isActive: req.auth.isActive
    }
  });
});

export default router;
