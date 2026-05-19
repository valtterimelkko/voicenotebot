import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createTestApp } from './setup';
import { settingsRouter } from '../src/routes/settings';
import request from 'supertest';

describe('settings routes', () => {
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    app = createTestApp();
    app.use('/api/settings', settingsRouter(db));
  });

  it('GET / returns default settings', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.default_cleanup_model).toBe('kimi');
    expect(res.body.retention_days).toBe(60);
    expect(res.body.stt_vocabulary).toBe('');
  });

  it('PUT / updates cleanup model', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ default_cleanup_model: 'gpt-5-nano' });
    expect(res.status).toBe(200);
    expect(res.body.default_cleanup_model).toBe('gpt-5-nano');
    expect(res.body.retention_days).toBe(60);
    expect(res.body.stt_vocabulary).toBe('');
  });

  it('PUT / updates retention days', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ retention_days: 30 });
    expect(res.status).toBe(200);
    expect(res.body.retention_days).toBe(30);
    expect(res.body.default_cleanup_model).toBe('kimi');
    expect(res.body.stt_vocabulary).toBe('');
  });

  it('PUT / updates both fields at once', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ default_cleanup_model: 'gpt-5-nano', retention_days: 7 });
    expect(res.status).toBe(200);
    expect(res.body.default_cleanup_model).toBe('gpt-5-nano');
    expect(res.body.retention_days).toBe(7);
    expect(res.body.stt_vocabulary).toBe('');
  });

  it('PUT / ignores invalid retention_days type', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ retention_days: 'not a number' });
    expect(res.status).toBe(200);
    expect(res.body.retention_days).toBe(60);
  });

  it('PUT / ignores invalid cleanup_model type', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ default_cleanup_model: 123 });
    expect(res.status).toBe(200);
    expect(res.body.default_cleanup_model).toBe('kimi');
  });

  it('PUT / with empty body keeps existing settings', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.default_cleanup_model).toBe('kimi');
    expect(res.body.retention_days).toBe(60);
    expect(res.body.stt_vocabulary).toBe('');
  });

  it('PUT / updates stt_vocabulary', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ stt_vocabulary: 'Claude\nAnthropic' });
    expect(res.status).toBe(200);
    expect(res.body.stt_vocabulary).toBe('Claude\nAnthropic');
    expect(res.body.default_cleanup_model).toBe('kimi');
    expect(res.body.retention_days).toBe(60);
  });

  it('PUT / ignores invalid stt_vocabulary type', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ stt_vocabulary: 123 });
    expect(res.status).toBe(200);
    expect(res.body.stt_vocabulary).toBe('');
  });

  it('persists settings across requests', async () => {
    await request(app)
      .put('/api/settings')
      .send({ retention_days: 21 });

    const res = await request(app).get('/api/settings');
    expect(res.body.retention_days).toBe(21);
  });

  it('persists stt_vocabulary across requests', async () => {
    await request(app)
      .put('/api/settings')
      .send({ stt_vocabulary: 'Claude' });

    const res = await request(app).get('/api/settings');
    expect(res.body.stt_vocabulary).toBe('Claude');
  });
});
