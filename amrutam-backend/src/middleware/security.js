import rateLimit from 'express-rate-limit';
import { httpError } from '../utils/http-error.js';

export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' } } });

export function requireMfa(req, res, next) {
  if (!req.auth?.mfaVerified) return next(httpError(403, 'MFA_REQUIRED', 'Enroll and log in with MFA to access this operation'));
  next();
}
