import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { requireMfa } from '../middleware/security.js';
import { parse, uuid } from '../utils/validation.js';
import { audit, transaction } from '../db/transaction.js';

const router = Router();
router.use(authenticate, requireRole('admin'), requireMfa);
router.get('/analytics', async (req, res) => {
  const query = parse(z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() }).strict(), req.query);
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400000);
  parse(z.boolean().refine(Boolean), from < to && to - from <= 366 * 86400000);
  const result = await pool.query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE status='scheduled')::int AS scheduled,
    count(*) FILTER(WHERE status='in_progress')::int AS "inProgress",
    count(*) FILTER(WHERE status='completed')::int AS completed,
    count(*) FILTER(WHERE status='cancelled')::int AS cancelled
    FROM consultations WHERE created_at >= $1 AND created_at < $2`, [from, to]);
  await audit(pool, req.auth.userId, 'ADMIN_ANALYTICS_READ', 'analytics', null);
  res.json({ data: { ...result.rows[0], from, to } });
});
router.patch('/doctors/:id/verification', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { status } = parse(z.object({ status: z.enum(['approved','rejected','pending']) }).strict(), req.body);
  const result = await transaction(pool, async db => {
    const result = await db.query('UPDATE doctor_profiles SET verification_status=$1,updated_at=NOW() WHERE user_id=$2 RETURNING user_id AS id, verification_status AS status', [status, id]);
    if (!result.rowCount) return null;
    await audit(db, req.auth.userId, 'DOCTOR_VERIFICATION_CHANGED', 'doctor', id, { status });
    return result.rows[0];
  });
  if (!result) return res.status(404).json({ error: { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found' } });
  res.json({ data: result });
});
router.get('/audit-logs', async (req, res) => {
  const { limit, before } = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20),
    before: z.string().regex(/^\d{1,19}$/).optional() }).strict(), req.query);
  const result = await pool.query(`SELECT id::text, actor_user_id AS "actorUserId",action,resource_type AS "resourceType",
    resource_id AS "resourceId",metadata,created_at AS "createdAt" FROM audit_logs
    WHERE ($1::numeric IS NULL OR id < $1::numeric) ORDER BY id DESC LIMIT $2`, [before ?? null, limit]);
  await audit(pool, req.auth.userId, 'AUDIT_LOG_READ', 'audit', null);
  res.json({ data: result.rows, pagination: { nextCursor: result.rows.length === limit ? result.rows.at(-1).id : null } });
});
export default router;
