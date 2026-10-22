import { readFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = new URL('../.env', import.meta.url);
const existing = readFileSync(path, 'utf8');
if (/^MFA_ENCRYPTION_KEY=/m.test(existing)) {
  console.log('MFA key already exists; left unchanged.');
} else {
  appendFileSync(path, `\nMFA_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`);
  console.log('Generated MFA encryption key in ignored local .env. Store a secure backup; never commit it.');
}
