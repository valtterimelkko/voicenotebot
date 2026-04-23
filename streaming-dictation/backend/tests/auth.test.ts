import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import { config } from '../src/config';
import { verifyPassword } from '../src/services/auth';
import { createTestDb, createTestApp } from './setup';
import { authRouter } from '../src/routes/auth';
import request from 'supertest';

describe('verifyPassword', () => {
  beforeEach(() => {
    config.passwordHash = bcrypt.hashSync('testpassword', 4);
  });

  it('returns true for correct password', async () => {
    expect(await verifyPassword('testpassword')).toBe(true);
  });

  it('returns false for wrong password', async () => {
    expect(await verifyPassword('wrongpassword')).toBe(false);
  });

  it('returns false when passwordHash is empty', async () => {
    config.passwordHash = '';
    expect(await verifyPassword('testpassword')).toBe(false);
  });
});

describe('POST /auth/login', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    config.passwordHash = bcrypt.hashSync('testpassword', 4);
    const db = createTestDb();
    app = createTestApp();
    app.use('/auth', authRouter(db));
  });

  it('logs in with correct password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: 'testpassword' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when no password provided', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when password is not a string', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: 123 });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/logout', () => {
  it('destroys session', async () => {
    config.passwordHash = bcrypt.hashSync('testpassword', 4);
    const db = createTestDb();
    const app = createTestApp();
    app.use('/auth', authRouter(db));

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ password: 'testpassword' });

    const res = await agent.post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sessionRes = await agent.get('/auth/session');
    expect(sessionRes.body.authenticated).toBe(false);
  });
});

describe('GET /auth/session', () => {
  it('returns authenticated: true when logged in', async () => {
    config.passwordHash = bcrypt.hashSync('testpassword', 4);
    const db = createTestDb();
    const app = createTestApp();
    app.use('/auth', authRouter(db));

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ password: 'testpassword' });

    const res = await agent.get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
  });

  it('returns authenticated: false when not logged in', async () => {
    const db = createTestDb();
    const app = createTestApp();
    app.use('/auth', authRouter(db));

    const res = await request(app).get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });
});
