import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Force test mode: the ambient NODE_ENV=production would otherwise make the
    // production sessionMiddleware emit `secure` cookies, which supertest (HTTP)
    // can't round-trip. Production keeps NODE_ENV=production via its .env.
    env: {
      NODE_ENV: 'test',
    },
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
