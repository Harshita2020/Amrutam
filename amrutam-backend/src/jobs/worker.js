import { pathToFileURL } from 'node:url';
import { pool } from '../config/db.js';
import { transaction } from '../db/transaction.js';
import { shutdownTracing } from '../observability/tracing.js';

export async function processNextJob(database = pool) {
  let job;
  try {
    return await transaction(database, async db => {
      job = (await db.query(`SELECT * FROM outbox_jobs WHERE status='pending' AND available_at<=NOW()
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if (!job) return false;
      // Replacing an aggregate snapshot is idempotent; never mutate clinical source records.
      const stats = await db.query(`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE status='completed')::int AS completed,
        count(*) FILTER(WHERE status='cancelled')::int AS cancelled FROM consultations`);
      await db.query(`INSERT INTO analytics_snapshots (id,data) VALUES (1,$1)
        ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`, [JSON.stringify(stats.rows[0])]);
      await db.query("UPDATE outbox_jobs SET status='completed',attempts=attempts+1 WHERE id=$1", [job.id]);
      return true;
    });
  } catch (error) {
    if (job) {
      // Retry transient infrastructure failures only, with bounded exponential backoff and jitter.
      const transient = /^(08|40|53|57)/.test(error.code ?? '') || ['ECONNRESET','ETIMEDOUT'].includes(error.code);
      const delay = Math.min(300, 2 ** (job.attempts + 1)) + Math.random();
      await database.query(`UPDATE outbox_jobs SET attempts=attempts+1,
        status=CASE WHEN attempts>=4 OR NOT $2 THEN 'failed' ELSE 'pending' END,
        available_at=NOW()+($3 * INTERVAL '1 second') WHERE id=$1 AND status='pending'`, [job.id, transient, delay]);
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stopped = false;
  process.once('SIGINT', () => { stopped = true; });
  process.once('SIGTERM', () => { stopped = true; });
  while (!stopped) {
    try { await processNextJob(); }
    catch (error) { console.error(JSON.stringify({ level: 'error', event: 'worker_failure', code: error.code ?? 'UNKNOWN' })); }
    if (!stopped) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await pool.end();
  await shutdownTracing();
}
