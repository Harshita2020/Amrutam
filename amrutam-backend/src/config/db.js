import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Enable TLS verification in production when using a hosted PostgreSQL provider.
  ssl: (env.DB_SSL ? env.DB_SSL === 'true' : env.NODE_ENV === 'production') ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on('error', (error) => {
  console.error('Unexpected idle PostgreSQL client error', { message: error.message });
});
