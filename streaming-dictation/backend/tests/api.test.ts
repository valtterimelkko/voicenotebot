import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import { config } from '../src/config';
import { createTestDb, createTestApp } from './setup';
import { authRouter } from '../src/routes/auth';
import { transcriptsRouter } from '../src/routes/transcripts';
import { settingsRouter } from '../src/routes/settings';
import { healthRouter } from '../src/routes/health';
import { requireAuth } from '../src/middleware/auth';
import request from 'supertest';

describe('API integration', () => {
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    config.passwordHash = bcrypt.hashSync('testpassword', 4);
    db = createTestDb();
    app = createTestApp();
    app.use('/auth', authRouter(db));
    app.use('/api/transcripts', requireAuth, transcriptsRouter(db));
    app.use('/api/settings', requireAuth, settingsRouter(db));
    app.use('/', healthRouter());
  });

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('protected transcripts route returns 401 without login', async () => {
    const res = await request(app).get('/api/transcripts');
    expect(res.status).toBe(401);
  });

  it('protected settings route returns 401 without login', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('login then GET /api/transcripts returns transcripts', async () => {
    const agent = request.agent(app);

    await agent.post('/auth/login').send({ password: 'testpassword' });

    db.prepare(
      `INSERT INTO transcripts (id, expires_at, raw_text, cleaned_text, preview_text) VALUES (?, ?, ?, ?, ?)`
    ).run('t1', '2099-01-01T00:00:00Z', 'raw note', 'clean note', 'clean note');

    const res = await agent.get('/api/transcripts');
    expect(res.status).toBe(200);
    expect(res.body.transcripts).toHaveLength(1);
    expect(res.body.transcripts[0].id).toBe('t1');
    expect(res.body.transcripts[0].raw_text).toBe('raw note');
  });

  it('login then GET /api/settings returns settings', async () => {
    const agent = request.agent(app);

    await agent.post('/auth/login').send({ password: 'testpassword' });

    const res = await agent.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.default_cleanup_model).toBe('kimi');
    expect(res.body.retention_days).toBe(60);
  });

  it('login then update settings persists across requests', async () => {
    const agent = request.agent(app);

    await agent.post('/auth/login').send({ password: 'testpassword' });

    await agent.put('/api/settings').send({ retention_days: 7 });

    const res = await agent.get('/api/settings');
    expect(res.body.retention_days).toBe(7);
  });

  it('login then logout then protected route returns 401', async () => {
    const agent = request.agent(app);

    await agent.post('/auth/login').send({ password: 'testpassword' });
    await agent.post('/auth/logout');

    const res = await agent.get('/api/transcripts');
    expect(res.status).toBe(401);
  });

  it('login then GET /health still works', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ password: 'testpassword' });

    const res = await agent.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
