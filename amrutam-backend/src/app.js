import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import healthRouter from './routes/health.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import authRouter from './routes/auth.js';
import doctorsRouter from './routes/doctors.js';
import bookingsRouter from './routes/bookings.js';
import consultationsRouter from './routes/consultations.js';
import adminRouter from './routes/admin.js';
import usersRouter from './routes/users.js';
import { observeHttp, registry } from './observability/http.js';
import { authenticate } from './middleware/authenticate.js';
import { requireRole } from './middleware/authorize.js';
import { requireMfa } from './middleware/security.js';
import { fileURLToPath } from 'node:url';

const app = express();

app.disable('x-powered-by');
app.use(observeHttp);
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((value) => value.trim()) }));
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false,
  skip: req => req.path === '/api/v1/health' || req.path === '/api/v1/health/ready',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } } }));

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/doctors', doctorsRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/consultations', consultationsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/users', usersRouter);
app.get('/api/v1/openapi.json', (_req,res) => res.sendFile(fileURLToPath(new URL('../openapi.json',import.meta.url))));
app.get('/api/v1/admin/metrics', authenticate, requireRole('admin'), requireMfa, async (_req, res) => {
  res.type(registry.contentType).send(await registry.metrics());
});

app.use(notFound);
app.use(errorHandler);

export default app;
