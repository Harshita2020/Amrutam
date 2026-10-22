import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

// Only the newly created database is migrated or dropped. Never use a developer DB for fixtures.
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
if (!adminUrl || process.env.NODE_ENV === 'production') {
  throw new Error('Provide a local TEST_ADMIN_DATABASE_URL (or development DATABASE_URL).');
}
const target = new URL(adminUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  throw new Error('Integration test provisioning is restricted to local PostgreSQL.');
}
const database = `amrutam_phase4_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  target.pathname = `/${database}`;
  console.log('Created disposable PostgreSQL test database.');
  const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.js', ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: target.toString(),
      PHASE4_TEST_DATABASE: database,
      JWT_SECRET: 'integration-only-secret-never-use-in-production',
      JWT_EXPIRES_IN: '15m',
      MFA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    }
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} catch (error) {
  console.error('Integration test runner failed:', error.code ?? error.name);
  process.exitCode = 1;
} finally {
  if (created) {
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    console.log('Removed disposable PostgreSQL test database.');
  }
  await admin.end();
}
