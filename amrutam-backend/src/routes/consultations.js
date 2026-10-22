import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { requireMfa } from '../middleware/security.js';
import { parse, uuid, idempotencyKey } from '../utils/validation.js';
import { createClinicalService } from '../services/clinical.js';

export const paginationSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0) });
export const prescriptionSchema = z.object({
  items: z.array(z.object({ medicationName: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1).max(1000), quantity: z.number().int().min(1).max(10000) }).strict()).min(1).max(30),
  notes: z.string().trim().max(2000).optional()
}).strict();
const service = createClinicalService({ pool });
const router = Router();
router.use(authenticate);
router.use((req, res, next) => req.auth.role === 'patient' ? next() : requireMfa(req, res, next));
router.get('/me', requireRole('patient', 'doctor'), async (req, res) => {
  const query = parse(paginationSchema.extend({ status: z.enum(['scheduled','in_progress','completed','cancelled']).optional() }).strict(), req.query);
  res.json(await service.list(req.auth, query));
});
router.get('/:id', async (req, res) => res.json({ data: await service.read(parse(uuid, req.params.id), req.auth) }));
router.patch('/:id/status', requireRole('doctor'), requireMfa, async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['in_progress','completed']) }).strict(), req.body);
  res.json({ data: await service.transition(parse(uuid, req.params.id), status, req.auth) });
});
router.post('/:id/prescriptions', requireRole('doctor'), requireMfa, async (req, res) => {
  const details = parse(prescriptionSchema, req.body);
  res.status(201).json({ data: await service.prescribe(parse(uuid, req.params.id), details, idempotencyKey(req), req.auth) });
});
router.get('/:id/prescriptions', async (req, res) => {
  res.json(await service.prescriptions(parse(uuid, req.params.id), req.auth, parse(paginationSchema.strict(), req.query)));
});
export default router;
