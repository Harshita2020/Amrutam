import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { httpError } from '../utils/http-error.js';

const tokenClaimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(['patient', 'doctor', 'admin']),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  sv: z.number().int().nonnegative().optional(),
  mfa: z.boolean().optional()
}).strict();

export async function authenticate(req, res, next) {
  const match = req.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
  if (!match) {
    return next(httpError(401, 'UNAUTHENTICATED', 'Authentication is required'));
  }

  let decoded;
  try {
    decoded = jwt.verify(match[1], env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return next(httpError(401, 'UNAUTHENTICATED', 'Authentication is invalid or expired'));
  }

  const claims = tokenClaimsSchema.safeParse(decoded);
  if (!claims.success) {
    return next(httpError(401, 'UNAUTHENTICATED', 'Authentication is invalid or expired'));
  }

  const result = await pool.query(
    'SELECT id, email, role, is_active, session_version, mfa_enabled FROM users WHERE id = $1',
    [claims.data.sub]
  );
  const user = result.rows[0];
  if (!user || !user.is_active || user.role !== claims.data.role ||
      (user.session_version ?? 0) !== (claims.data.sv ?? 0) ||
      (user.mfa_enabled && !claims.data.mfa)) {
    return next(httpError(401, 'UNAUTHENTICATED', 'Authentication is invalid or expired'));
  }

  req.auth = {
    userId: user.id,
    email: user.email,
    role: user.role,
    isActive: user.is_active,
    mfaVerified: Boolean(user.mfa_enabled && claims.data.mfa)
  };
  return next();
}
