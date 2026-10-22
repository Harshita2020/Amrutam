import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { parse } from '../utils/validation.js';
import { transaction, audit } from '../db/transaction.js';
const router = Router();
router.patch('/me', authenticate, requireRole('patient'), async (req, res) => {
  const data = parse(z.object({ fullName: z.string().trim().min(1).max(120), phone: z.string().trim().max(30).nullable().optional() }).strict(), req.body);
  const result = await transaction(pool, async db => {
    const result = await db.query(`INSERT INTO patient_profiles (user_id,full_name,phone) VALUES ($1,$2,$3)
      ON CONFLICT (user_id) DO UPDATE SET full_name=EXCLUDED.full_name,phone=EXCLUDED.phone
      RETURNING user_id AS id,full_name AS "fullName",phone`, [req.auth.userId, data.fullName, data.phone ?? null]);
    await audit(db, req.auth.userId, 'PATIENT_PROFILE_UPDATED', 'user', req.auth.userId);
    return result.rows[0];
  });
  res.json({ data: result });
});
export default router;
