import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/*.test.js'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      JWT_SECRET: 'unit-test-only-secret-never-use-in-production',
      JWT_EXPIRES_IN: '15m',
      MFA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    }
  }
});
