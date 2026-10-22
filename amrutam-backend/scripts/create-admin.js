import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../src/config/db.js';
import { transaction, audit } from '../src/db/transaction.js';

try {
  const email = z.string().trim().toLowerCase().email().parse(process.env.ADMIN_EMAIL);
  const password = z.string().min(12).max(72).refine(v => Buffer.byteLength(v) <= 72).parse(process.env.ADMIN_PASSWORD);
  await transaction(pool, async db => {
    const row = (await db.query(`INSERT INTO users (email,password_hash,role) VALUES ($1,$2,'admin') RETURNING id`,
      [email, await bcrypt.hash(password,12)])).rows[0];
    await audit(db, row.id, 'ADMIN_PROVISIONED', 'user', row.id);
  });
  console.log('Administrator created. Log in and enroll MFA before accessing admin operations.');
} catch (error) {
  console.error('Admin provisioning failed:', error.code ?? error.name);
  process.exitCode = 1;
} finally { await pool.end(); }
