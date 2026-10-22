import 'dotenv/config';
import { z } from 'zod';

const jwtExpirySchema = z.string()
  .regex(/^[1-9]\d*[smhd]$/, 'JWT_EXPIRES_IN must be a positive duration in seconds, minutes, hours, or days')
  .refine((duration) => {
    const match = duration.match(/^([1-9]\d*)([smhd])$/);
    if (!match) return false;
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
    return Number(match[1]) * multiplier <= 86400;
  }, 'JWT_EXPIRES_IN must not exceed 24 hours');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: jwtExpirySchema.default('15m'),
  MFA_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  DB_SSL: z.enum(['true', 'false']).optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
