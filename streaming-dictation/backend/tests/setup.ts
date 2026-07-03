import express from 'express';
import session from 'express-session';
import { initDatabase, DB } from '../src/db';

export function createTestDb(): DB {
  return initDatabase(':memory:');
}

/**
 * Lightweight Express harness for unit-testing a single router in isolation
 * (no auth, no full middleware stack). For full-stack integration tests use
 * `createApp(db)` below instead.
 */
export function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));
  return app;
}

/** Full-stack factory shared with production (src/app.ts). */
export { createApp } from '../src/app';
