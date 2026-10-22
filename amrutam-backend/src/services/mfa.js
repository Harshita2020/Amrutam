import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';
import { httpError } from '../utils/http-error.js';

export function createMfaService(encryptionKey) {
  function key() {
    if (!encryptionKey || !/^[a-fA-F0-9]{64}$/.test(encryptionKey)) {
      throw httpError(503, 'MFA_NOT_CONFIGURED', 'MFA encryption key is not configured');
    }
    return Buffer.from(encryptionKey, 'hex');
  }
  function encrypt(secret, userId) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), nonce);
    cipher.setAAD(Buffer.from(userId));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [nonce, cipher.getAuthTag(), encrypted].map(value => value.toString('base64')).join('.');
  }
  function decrypt(value, userId) {
    const [nonce, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key(), nonce);
    cipher.setAAD(Buffer.from(userId));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
  }
  const totp = (secret, email) => new TOTP({ issuer: 'Amrutam', label: email ?? 'account',
    algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
  function verify(encrypted, userId, token, lastStep, now = Date.now()) {
    if (!encrypted || !/^\d{6}$/.test(token ?? '')) return null;
    const delta = totp(decrypt(encrypted, userId)).validate({ token, window: 1, timestamp: now });
    const step = Math.floor(now / 30000) + (delta ?? 0);
    return delta !== null && step > Number(lastStep) ? step : null;
  }
  function enroll(userId, email) {
    const secret = new Secret({ size: 20 }).base32;
    return { encrypted: encrypt(secret, userId), secret, otpauthUri: totp(secret, email).toString() };
  }
  const hashRecovery = value => createHash('sha256').update(value).digest('hex');
  function recoveryCodes() {
    const codes = Array.from({ length: 8 }, () => randomBytes(16).toString('hex'));
    return { codes, hashes: codes.map(hashRecovery) };
  }
  function consumeRecovery(hashes, value) {
    const hash = Buffer.from(hashRecovery(value), 'hex');
    const index = hashes.findIndex(candidate => timingSafeEqual(Buffer.from(candidate, 'hex'), hash));
    return index < 0 ? null : hashes.filter((_, i) => i !== index);
  }
  return { enroll, verify, recoveryCodes, consumeRecovery, encrypt, decrypt };
}
