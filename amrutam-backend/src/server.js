import app from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { shutdownTracing } from './observability/tracing.js';

const server = app.listen(env.PORT, () => {
  console.log(`Amrutam API listening on port ${env.PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully`);
  server.close(async () => {
    await pool.end();
    await shutdownTracing();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
