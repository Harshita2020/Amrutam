import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/*.test.js'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000
  }
});
