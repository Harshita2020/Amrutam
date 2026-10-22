import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { httpError } from '../utils/http-error.js';

const router = Router();
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(12).max(72).refine((password) => Buffer.byteLength(password, 'utf8') <= 72),
  role: z.enum(['patient', 'doctor'])
}).strict();
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72).refine((password) => Buffer.byteLength(password, 'utf8') <= 72)
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

router.post('/register', async (req, res) => {
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
  res.status(201).json({
    data: {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.is_active
    }
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = parseRequest(loginSchema, req.body);
  const result = await pool.query(
    `SELECT id, email, password_hash, role, is_active
     FROM users
     WHERE lower(btrim(email)) = $1`,
    [email]
  );
  const user = result.rows[0];
  const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!user || !user.is_active || !passwordMatches) {
    throw httpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  const accessToken = jwt.sign(
    { role: user.role },
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
