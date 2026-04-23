import express from 'express';
import session from 'express-session';
import { initDatabase, DB } from '../src/db';

export function createTestDb(): DB {
  return initDatabase(':memory:');
}

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
