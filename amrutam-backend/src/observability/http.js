import { randomUUID } from 'node:crypto';
import { Registry, Histogram, Counter, collectDefaultMetrics } from 'prom-client';
import { trace } from '@opentelemetry/api';

export const registry = new Registry();
if (process.env.NODE_ENV !== 'test') collectDefaultMetrics({ register: registry });
const duration = new Histogram({ name: 'amrutam_http_duration_seconds', help: 'HTTP request duration',
  labelNames: ['method','route','status'], buckets: [.01,.025,.05,.1,.2,.5,1,2,5], registers: [registry] });
const requests = new Counter({ name: 'amrutam_http_requests_total', help: 'HTTP requests',
  labelNames: ['method','route','status'], registers: [registry] });

export function observeHttp(req, res, next) {
  const id = randomUUID();
  const started = process.hrtime.bigint();
  req.requestId = id;
  res.set('X-Request-ID', id);
  res.set('Cache-Control', 'no-store');
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  res.once('finish', () => {
    const group = req.originalUrl.split('?')[0].split('/').slice(0, 4).join('/');
    const route = req.route?.path ? (String(req.route.path).startsWith('/api/') ? req.route.path : `${group}${req.route.path}`) : 'unmatched';
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    duration.observe(labels, seconds);
    requests.inc(labels);
    if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify({ level: 'info', event: 'http_request',
      requestId: id, traceId, ...labels, durationMs: Math.round(seconds * 1000) }));
  });
  next();
}
