import { describe, it, expect } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { createMfaService } from '../src/services/mfa.js';
const mfa = createMfaService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
describe('MFA cryptography and replay protection', () => {
  it('encrypts a secret with account-bound authenticated encryption', () => {
    const encrypted = mfa.encrypt('SENSITIVE-SEED', 'account-a');
    expect(encrypted).not.toContain('SENSITIVE-SEED');
    expect(mfa.decrypt(encrypted, 'account-a')).toBe('SENSITIVE-SEED');
    expect(() => mfa.decrypt(encrypted, 'account-b')).toThrow();
  });
  it('accepts valid TOTP once, rejects reused steps, and rejects incorrect codes', () => {
    const entry = mfa.enroll('account-a', 'test@example.test');
    const now = 1800000000000;
    const otp = new TOTP({ secret: Secret.fromBase32(entry.secret), digits: 6, period: 30, algorithm: 'SHA1' });
    const token = otp.generate({ timestamp: now });
    const step = mfa.verify(entry.encrypted, 'account-a', token, -1, now);
    expect(step).toBe(Math.floor(now / 30000));
    expect(mfa.verify(entry.encrypted, 'account-a', token, step, now)).toBeNull();
    expect(mfa.verify(entry.encrypted, 'account-a', 'invalid', -1, now)).toBeNull();
  });
  it('consumes recovery codes once without storing plaintext', () => {
    const recovery = mfa.recoveryCodes();
    expect(recovery.hashes).not.toContain(recovery.codes[0]);
    const remaining = mfa.consumeRecovery(recovery.hashes, recovery.codes[0]);
    expect(remaining).toHaveLength(7);
    expect(mfa.consumeRecovery(remaining, recovery.codes[0])).toBeNull();
  });
  it('fails closed when encryption is not configured', () => {
    expect(() => createMfaService().enroll('account-a', 'test@example.test')).toThrow('not configured');
  });
});
