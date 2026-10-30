import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import bcrypt from 'bcrypt';
import { config } from '../src/config';
import { createTestDb, createApp } from './setup';
import { resetForTesting } from '../src/services/connectionPool';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../src/services/stt', () => ({
  transcribeWithFallback: vi.fn().mockResolvedValue({
    text: 'Hello world this is a test transcription about important things',
    model: 'grok-voice-transcribe-2.0',
    usedFallback: false,
  }),
  startSpeculativeTranscription: vi.fn().mockReturnValue({
    promise: Promise.resolve({
      text: 'Hello world speculative transcription',
      model: 'grok-voice-transcribe-2.0',
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
    model: 'gpt-5-nano',
  }),
}));

import { transcribeWithFallback } from '../src/services/stt';
import { cleanupTranscript } from '../src/services/cleanup';

const mockedTranscribe = vi.mocked(transcribeWithFallback);
const mockedCleanup = vi.mocked(cleanupTranscript);

describe('E2E: full login → recording → transcript → search → copy flow', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof createTestDb>;
  let agent: ReturnType<typeof request.agent>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetForTesting();
    mockedTranscribe.mockResolvedValue({
      text: 'Hello world this is a test transcription about important things',
      model: 'grok-voice-transcribe-2.0',
      usedFallback: false,
    });
    mockedCleanup.mockResolvedValue({
      cleanedText: 'Hello world, this is a cleaned transcription about important things.',
      model: 'gpt-5-nano',
    });

    config.passwordHash = bcrypt.hashSync('testpassword', 4);
    db = createTestDb();
    app = createApp(db);
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
    expect(finishRes.body.stt_model).toBe('grok-voice-transcribe-2.0');
    expect(finishRes.body.cleanup_model).toBe('gpt-5-nano');
    expect(finishRes.body.status).toBe('completed');

    expect(mockedTranscribe).toHaveBeenCalledOnce();
    // default settings pin English for STT (wrong-language-transcript fix)
    expect(mockedTranscribe.mock.calls[0][2]).toBe('en');
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
    expect(getSettingsRes.body.retention_days).toBe(60);
  });

  it('passes the configured stt_language to the STT tier on finish', async () => {
    await agent.post('/auth/login').send({ password: 'testpassword' });
    const putRes = await agent.put('/api/settings').send({ stt_language: 'fi' });
    expect(putRes.status).toBe(200);

    const startRes = await agent.post('/api/recordings/start');
    const recordingId = startRes.body.id;
    await agent
      .post(`/api/recordings/${recordingId}/stream`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('fake-audio'));
    const finishRes = await agent.post(`/api/recordings/${recordingId}/finish`);
    expect(finishRes.status).toBe(200);
    expect(mockedTranscribe).toHaveBeenCalledOnce();
    expect(mockedTranscribe.mock.calls[0][2]).toBe('fi');
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
    // Total transcription failure must be marked, not silently saved as completed.
    expect(finishRes.body.status).toBe('error');
  });

  async function finishWithRaw(raw: string) {
    mockedTranscribe.mockResolvedValue({ text: raw, model: 'gpt-transcribe', usedFallback: true });
    await agent.post('/auth/login').send({ password: 'testpassword' });
    const recordingId = (await agent.post('/api/recordings/start')).body.id;
    await agent
      .post(`/api/recordings/${recordingId}/stream`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('audio'));
    return agent.post(`/api/recordings/${recordingId}/finish`);
  }

  it('skips cleanup when the transcriber heard no words, and marks the recording failed (owner, 2026-10-26)', async () => {
    // A broken or silent recording came back as one character; the cleanup model then answered it like a chat
    // ("Please provide the transcript…") and that reply was pasted as if the owner had said it.
    for (const raw of ['.', ' ', 'a', '…!']) {
      mockedCleanup.mockClear();
      const finishRes = await finishWithRaw(raw);
      expect(finishRes.status).toBe(200);
      expect(mockedCleanup).not.toHaveBeenCalled();
      expect(finishRes.body.raw_text).toBe('');
      expect(finishRes.body.cleaned_text).toBe('');
      expect(finishRes.body.status).toBe('error');
    }
  });

  it('still cleans a short real dictation', async () => {
    const finishRes = await finishWithRaw('Yes');
    expect(mockedCleanup).toHaveBeenCalledOnce();
    expect(finishRes.body.status).toBe('completed');
  });

  it('handles cleanup failure gracefully', async () => {
    mockedTranscribe.mockResolvedValue({
      text: 'Some raw text',
      model: 'grok-voice-transcribe-2.0',
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
    // Cleanup failure with usable raw text is still a completed transcript.
    expect(finishRes.body.status).toBe('completed');
  });

  describe('failed audio is kept for diagnosis (owner, 2026-10-30)', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failed-audio-e2e-'));
      config.failedAudioDir = dir;
    });
    afterEach(() => {
      config.failedAudioDir = '';
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps the audio of a dictation in which no words were heard', async () => {
      const finishRes = await finishWithRaw('.');
      expect(finishRes.body.status).toBe('error');
      const id = finishRes.body.id as string;
      expect(fs.readFileSync(path.join(dir, `${id}.audio`)).toString()).toBe('audio');
      expect(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')).reason).toBe('no-words');
    });

    it('keeps the audio when transcription failed outright', async () => {
      mockedTranscribe.mockRejectedValueOnce(new Error('STT service unavailable'));
      await agent.post('/auth/login').send({ password: 'testpassword' });
      const recordingId = (await agent.post('/api/recordings/start')).body.id;
      await agent.post(`/api/recordings/${recordingId}/stream`).set('Content-Type', 'application/octet-stream').send(Buffer.from('audio'));
      await agent.post(`/api/recordings/${recordingId}/finish`);
      expect(JSON.parse(fs.readFileSync(path.join(dir, `${recordingId}.json`), 'utf8')).reason).toBe('stt-failed');
    });

    it('keeps nothing for a dictation that worked', async () => {
      const finishRes = await finishWithRaw('Yes, that worked');
      expect(finishRes.body.status).toBe('completed');
      expect(fs.readdirSync(dir)).toHaveLength(0);
    });

    it('keeps nothing when no folder is configured', async () => {
      config.failedAudioDir = '';
      await finishWithRaw('.');
      expect(fs.readdirSync(dir)).toHaveLength(0);
    });
  });
});
