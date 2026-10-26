/**
 * The local service token (2026-10-26): the Wheelhouse command centre on this host sends the owner's microphone audio
 * here from its large session view, so it may use the recording routes with `Authorization: Bearer <token>` (the token
 * file named by SERVICE_TOKEN_FILE). Only the recording routes; transcripts and settings keep the password session.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { config } from '../src/config';
import { createTestDb, createApp } from './setup';
import request from 'supertest';

const TOKEN = 'a'.repeat(48);

describe('service token on the recording routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    config.serviceToken = TOKEN;
    app = createApp(createTestDb());
  });

  afterEach(() => {
    config.serviceToken = '';
  });

  it('starts and aborts a recording with the token', async () => {
    const start = await request(app).post('/api/recordings/start').set('authorization', `Bearer ${TOKEN}`).send({});
    expect(start.status).toBe(200);
    expect(typeof start.body.id).toBe('string');
    const abort = await request(app).post(`/api/recordings/${start.body.id}/abort`).set('authorization', `Bearer ${TOKEN}`).send({});
    expect(abort.status).toBe(200);
    const stream = await request(app)
      .post(`/api/recordings/${start.body.id}/stream`)
      .set('authorization', `Bearer ${TOKEN}`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from([1, 2, 3]));
    expect(stream.status).toBe(404); // aborted: gone
  });

  it('refuses a wrong token, and the token opens nothing but recordings', async () => {
    expect((await request(app).post('/api/recordings/start').set('authorization', `Bearer ${'b'.repeat(48)}`).send({})).status).toBe(401);
    expect((await request(app).get('/api/transcripts').set('authorization', `Bearer ${TOKEN}`)).status).toBe(401);
    expect((await request(app).get('/api/settings').set('authorization', `Bearer ${TOKEN}`)).status).toBe(401);
  });

  it('accepts no token at all when none is configured', async () => {
    config.serviceToken = '';
    expect((await request(app).post('/api/recordings/start').set('authorization', 'Bearer ').send({})).status).toBe(401);
  });
});
