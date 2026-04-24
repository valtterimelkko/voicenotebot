import { describe, it, expect, beforeEach, vi } from 'vitest';
import bcrypt from 'bcrypt';
import { config } from '../src/config';
import { createTestDb, createTestApp } from './setup';
import { authRouter } from '../src/routes/auth';
import { recordingsRouter } from '../src/routes/recordings';
import { transcriptsRouter } from '../src/routes/transcripts';
import { settingsRouter } from '../src/routes/settings';
import { requireAuth } from '../src/middleware/auth';
import { resetForTesting } from '../src/services/connectionPool';
import request from 'supertest';

vi.mock('../src/services/stt', () => ({
  transcribeWithFallback: vi.fn().mockResolvedValue({
    text: 'Hello world this is a test transcription about important things',
    model: 'gpt-4o-mini-transcribe',
    usedFallback: false,
  }),
  startSpeculativeTranscription: vi.fn().mockReturnValue({
    promise: Promise.resolve({
      text: 'Hello world speculative transcription',
      model: 'gpt-4o-mini-transcribe',
      usedFallback: false,
    }),
    chunkCount: 3,
    startedAt: Date.now(),
  }),
  shouldUseSpeculative: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/services/cleanup', () => ({
  cleanupTranscript: vi.fn().mockResolvedValue({
    cleanedText: 'Hello world, this is a cleaned transcription about important things.',
    model: 'kimi',
  }),
}));

import { transcribeWithFallback } from '../src/services/stt';
import { cleanupTranscript } from '../src/services/cleanup';

const mockedTranscribe = vi.mocked(transcribeWithFallback);
const mockedCleanup = vi.mocked(cleanupTranscript);

describe('E2E: full login → recording → transcript → search → copy flow', () => {
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof createTestDb>;
  let agent: ReturnType<typeof request.agent>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetForTesting();
    mockedTranscribe.mockResolvedValue({
      text: 'Hello world this is a test transcription about important things',
      model: 'gpt-4o-mini-transcribe',
      usedFallback: false,
    });
    mockedCleanup.mockResolvedValue({
      cleanedText: 'Hello world, this is a cleaned transcription about important things.',
      model: 'kimi',
    });

    config.passwordHash = bcrypt.hashSync('testpassword', 4);
    db = createTestDb();
    app = createTestApp();
    app.use('/auth', authRouter(db));
    app.use('/api/recordings', requireAuth, recordingsRouter(db));
    app.use('/api/transcripts', requireAuth, transcriptsRouter(db));
    app.use('/api/settings', requireAuth, settingsRouter(db));
    agent = request.agent(app);
  });

  it('completes the full recording lifecycle', async () => {
    const loginRes = await agent
      .post('/auth/login')
      .send({ password: 'testpassword' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.ok).toBe(true);

    const startRes = await agent.post('/api/recordings/start');
    expect(startRes.status).toBe(200);
    expect(startRes.body.id).toBeDefined();
    const recordingId = startRes.body.id;

    const audioChunk = Buffer.from('fake-audio-data-for-testing');
    const streamRes = await agent
      .post(`/api/recordings/${recordingId}/stream`)
      .set('Content-Type', 'application/octet-stream')
      .send(audioChunk);
    expect(streamRes.status).toBe(200);
    expect(streamRes.body.ok).toBe(true);

    const finishRes = await agent.post(`/api/recordings/${recordingId}/finish`);
    expect(finishRes.status).toBe(200);
    expect(finishRes.body.id).toBe(recordingId);
    expect(finishRes.body.raw_text).toBe('Hello world this is a test transcription about important things');
    expect(finishRes.body.cleaned_text).toBe('Hello world, this is a cleaned transcription about important things.');
    expect(finishRes.body.stt_model).toBe('gpt-4o-mini-transcribe');
    expect(finishRes.body.cleanup_model).toBe('kimi');
    expect(finishRes.body.status).toBe('completed');

    expect(mockedTranscribe).toHaveBeenCalledOnce();
    expect(mockedCleanup).toHaveBeenCalledOnce();

    const listRes = await agent.get('/api/transcripts');
    expect(listRes.status).toBe(200);
    expect(listRes.body.transcripts).toHaveLength(1);
    expect(listRes.body.transcripts[0].id).toBe(recordingId);
    expect(listRes.body.transcripts[0].cleaned_text).toBe('Hello world, this is a cleaned transcription about important things.');

    const searchRes = await agent.get('/api/transcripts/search?q=cleaned');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.transcripts).toHaveLength(1);
    expect(searchRes.body.transcripts[0].id).toBe(recordingId);

    const notFoundRes = await agent.get('/api/transcripts/search?q=zzzznonexistent');
    expect(notFoundRes.status).toBe(200);
    expect(notFoundRes.body.transcripts).toHaveLength(0);

    const singleRes = await agent.get(`/api/transcripts/${recordingId}`);
    expect(singleRes.status).toBe(200);
    expect(singleRes.body.id).toBe(recordingId);
    expect(singleRes.body.raw_text).toBe('Hello world this is a test transcription about important things');
    expect(singleRes.body.cleaned_text).toBe('Hello world, this is a cleaned transcription about important things.');

    const updateSettingsRes = await agent
      .put('/api/settings')
      .send({ default_cleanup_model: 'gpt-5-nano' });
    expect(updateSettingsRes.status).toBe(200);
    expect(updateSettingsRes.body.default_cleanup_model).toBe('gpt-5-nano');

    const getSettingsRes = await agent.get('/api/settings');
    expect(getSettingsRes.status).toBe(200);
    expect(getSettingsRes.body.default_cleanup_model).toBe('gpt-5-nano');
    expect(getSettingsRes.body.retention_days).toBe(14);
  });

  it('warmup endpoint returns ok when authenticated', async () => {
    await agent.post('/auth/login').send({ password: 'testpassword' });

    const res = await agent.post('/api/recordings/warmup');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('warmup endpoint requires authentication', async () => {
    const res = await request(app).post('/api/recordings/warmup');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const unauthAgent = request.agent(app);

    const res1 = await unauthAgent.post('/api/recordings/start');
    expect(res1.status).toBe(401);

    const res2 = await unauthAgent.get('/api/transcripts');
    expect(res2.status).toBe(401);

    const res3 = await unauthAgent.get('/api/transcripts/search?q=test');
    expect(res3.status).toBe(401);

    const res4 = await unauthAgent.get('/api/settings');
    expect(res4.status).toBe(401);
  });

  it('returns 404 for unknown recording on stream and finish', async () => {
    await agent.post('/auth/login').send({ password: 'testpassword' });

    const streamRes = await agent
      .post('/api/recordings/nonexistent-id/stream')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('audio'));
    expect(streamRes.status).toBe(404);

    const finishRes = await agent.post('/api/recordings/nonexistent-id/finish');
    expect(finishRes.status).toBe(404);
  });

  it('returns 400 for empty audio chunk', async () => {
    await agent.post('/auth/login').send({ password: 'testpassword' });

    const startRes = await agent.post('/api/recordings/start');
    const recordingId = startRes.body.id;

    const streamRes = await agent
      .post(`/api/recordings/${recordingId}/stream`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0));
    expect(streamRes.status).toBe(400);
  });

  it('returns 404 for unknown transcript', async () => {
    await agent.post('/auth/login').send({ password: 'testpassword' });

    const res = await agent.get('/api/transcripts/nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('handles STT failure gracefully', async () => {
    mockedTranscribe.mockRejectedValueOnce(new Error('STT service unavailable'));

    await agent.post('/auth/login').send({ password: 'testpassword' });

    const startRes = await agent.post('/api/recordings/start');
    const recordingId = startRes.body.id;

    await agent
      .post(`/api/recordings/${recordingId}/stream`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('audio'));

    const finishRes = await agent.post(`/api/recordings/${recordingId}/finish`);
    expect(finishRes.status).toBe(200);
    expect(finishRes.body.raw_text).toBe('');
    expect(finishRes.body.cleaned_text).toBe('');
  });

  it('handles cleanup failure gracefully', async () => {
    mockedTranscribe.mockResolvedValue({
      text: 'Some raw text',
      model: 'gpt-4o-mini-transcribe',
      usedFallback: false,
    });
    mockedCleanup.mockRejectedValueOnce(new Error('Cleanup failed'));

    await agent.post('/auth/login').send({ password: 'testpassword' });

    const startRes = await agent.post('/api/recordings/start');
    const recordingId = startRes.body.id;

    await agent
      .post(`/api/recordings/${recordingId}/stream`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('audio'));

    const finishRes = await agent.post(`/api/recordings/${recordingId}/finish`);
    expect(finishRes.status).toBe(200);
    expect(finishRes.body.raw_text).toBe('Some raw text');
    expect(finishRes.body.cleaned_text).toBe('Some raw text');
  });
});
