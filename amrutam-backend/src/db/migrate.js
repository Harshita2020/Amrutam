import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Initializes the schema_migrations table and reconciles pre-applied migrations.
 * Detects objects created manually in pgAdmin (001, 002, 003) so they are baselined
 * and never re-run.
 */
async function ensureMigrationsTableAndBaseline(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedResult = await client.query('SELECT name FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((row) => row.name));

  // Baseline detection for migrations applied manually via pgAdmin prior to runner introduction:
  // 1. Check for 001_initial_schema.sql (all 8 baseline tables must exist)
  if (!applied.has('001_initial_schema.sql')) {
    const res = await client.query(`
      SELECT count(DISTINCT table_name)::int AS count
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('users', 'doctor_profiles', 'patient_profiles', 'availability_slots', 'consultations', 'prescriptions', 'payments', 'audit_logs')
    `);
    if (res.rows[0]?.count === 8) {
      await client.query(
        'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
        ['001_initial_schema.sql']
      );
      applied.add('001_initial_schema.sql');
    } else if (res.rows[0]?.count > 0) {
      console.warn(`[migrate] Warning: 001_initial_schema.sql is partially applied (${res.rows[0].count}/8 tables found). Skipping baseline.`);
    }
  }

  // 2. Check for 002_normalized_user_email.sql (existence of 'users_email_normalized_uidx')
  if (!applied.has('002_normalized_user_email.sql')) {
    const res = await client.query(`
      SELECT 1 FROM pg_indexes 
      WHERE schemaname = 'public' AND indexname = 'users_email_normalized_uidx'
    `);
    if (res.rowCount > 0) {
      await client.query(
        'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
        ['002_normalized_user_email.sql']
      );
      applied.add('002_normalized_user_email.sql');
    }
  }

  // 3. Check for 003_doctor_profiles_and_slots.sql (all 3 columns and 2 indexes must exist)
  if (!applied.has('003_doctor_profiles_and_slots.sql')) {
    const colRes = await client.query(`
      SELECT count(*)::int AS count
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND (
          (table_name = 'doctor_profiles' AND column_name IN ('verification_status', 'updated_at'))
          OR (table_name = 'availability_slots' AND column_name = 'updated_at')
        )
    `);
    const idxRes = await client.query(`
      SELECT count(*)::int AS count
      FROM pg_indexes 
      WHERE schemaname = 'public' 
        AND indexname IN ('idx_doctor_profiles_discoverable', 'idx_slots_doctor_status_start')
    `);
    if (colRes.rows[0]?.count === 3 && idxRes.rows[0]?.count === 2) {
      await client.query(
        'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
        ['003_doctor_profiles_and_slots.sql']
      );
      applied.add('003_doctor_profiles_and_slots.sql');
    } else if ((colRes.rows[0]?.count ?? 0) > 0 || (idxRes.rows[0]?.count ?? 0) > 0) {
      console.warn(`[migrate] Warning: 003_doctor_profiles_and_slots.sql is partially applied (${colRes.rows[0]?.count}/3 columns, ${idxRes.rows[0]?.count}/2 indexes). Skipping baseline.`);
    }
  }

  // 4. Require every index and removal of the old constraint before baselining 004.
  if (!applied.has('004_booking_and_cancellations.sql')) {
    const res = await client.query(`
      SELECT 1 WHERE
        (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
         AND indexname IN ('consultations_active_slot_uidx', 'idx_consultations_patient_status', 'idx_consultations_status')) = 3
        AND NOT EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid = to_regclass('public.consultations') AND conname = 'consultations_slot_id_key')
    `);
    if (res.rowCount > 0) {
      await client.query(
        'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
        ['004_booking_and_cancellations.sql']
      );
      applied.add('004_booking_and_cancellations.sql');
    }
  }

  return applied;
}

/**
 * Runs only pending migrations in alphabetical order within transactional boundaries.
 */
export async function runMigrations() {
  const client = await pool.connect();
  try {
    const applied = await ensureMigrationsTableAndBaseline(client);
    const migrationsDir = path.join(__dirname, 'migrations');
    const allFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

    const pendingFiles = allFiles.filter((file) => !applied.has(file));

    if (pendingFiles.length === 0) {
      console.log('No pending migrations. Database schema is up to date.');
      return [];
    }

    console.log(`Found ${pendingFiles.length} pending migration(s):`, pendingFiles);

    const executed = [];
    for (const file of pendingFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`Executing migration: ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        executed.push(file);
        console.log(`Successfully applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error in migration ${file}:`, err.message);
        throw err;
      }
    }

    return executed;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async (executed) => {
      console.log(`Migration completed. ${executed.length} migration(s) executed.`);
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('Migration execution failed:', error.message);
      await pool.end();
      process.exit(1);
    });
}
