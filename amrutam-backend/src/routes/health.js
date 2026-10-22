import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();

router.get('/', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'amrutam-backend' });
});

router.get('/ready', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready', database: 'connected' });
  } catch (error) {
    error.statusCode = 503;
    error.code = 'DATABASE_UNAVAILABLE';
    error.message = 'Database is unavailable';
    next(error);
  }
});

export default router;
