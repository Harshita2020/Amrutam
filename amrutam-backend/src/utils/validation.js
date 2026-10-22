import { z } from 'zod';
import { httpError } from './http-error.js';

export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw httpError(400, 'VALIDATION_ERROR', 'Request validation failed');
  return result.data;
}
export const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const password = z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72);
export const code = z.string().regex(/^\d{6}$/);
export function idempotencyKey(req) {
  return parse(z.string().trim().min(1).max(200), req.get('Idempotency-Key'));
}
