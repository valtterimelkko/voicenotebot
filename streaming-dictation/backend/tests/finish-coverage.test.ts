/**
 * `/finish` coverage (owner, 2026-11-11): a 195.6 s Android dictation came back as 739 characters — a bit more than a
 * quarter of it — with no error anywhere, because xAI had answered 200 with the part of the audio it managed to decode
 * and the backend stored that as a `completed` transcript.
 *
 * These tests drive the recordings router with a fake xAI endpoint that reports the decoded duration xAI really sends.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestApp, createTestDb } from './setup';
import { config } from '../src/config';

vi.mock('../src/services/cleanup', () => ({
  cleanupTranscript: vi.fn(async (text: string) => ({ cleanedText: text, model: 'gpt-5-nano' })),
}));

import { recordingsRouter } from '../src/routes/recordings';

interface FakeXai {
  url: string;
  calls: number;
  close: () => void;
}

/** A fake xAI STT endpoint that answers each call from `answers` (the last one repeats). */
function fakeXai(answers: Array<{ text: string; duration?: number }>): Promise<FakeXai> {
  const state: FakeXai = { url: '', calls: 0, close: () => {} };
  const server = http.createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      const answer = answers[Math.min(state.calls, answers.length - 1)];
      state.calls += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      state.url = `http://127.0.0.1:${port}/v1/stt`;
      state.close = () => server.close();
      resolve(state);
    });
  });
}

const RECORDED_MS = 195_559;
const TOTAL_CHUNKS = 48;

describe('/finish: a transcript that covers only part of the recording', () => {
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof createTestDb>;
  let clock: number;
  let failedAudioDir: string;
  let xai: FakeXai | null = null;
  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(name: string, value: string | undefined) {
    savedEnv[name] = savedEnv[name] ?? process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  beforeEach(async () => {
    clock = 1_000_000;
    failedAudioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-coverage-'));
    setEnv('LOCAL_ASR_URL', 'http://127.0.0.1:9/asr'); // nothing listens: the local tier must not mask a failure
    config.xaiApiKey = 'test-xai-key';
    config.failedAudioDir = failedAudioDir;
    config.serviceToken = '';
    db = createTestDb();
    app = createTestApp();
    app.use(
      '/api/recordings',
      recordingsRouter(db, { now: () => clock }),
    );
  });

  afterEach(() => {
    xai?.close();
    xai = null;
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
      delete savedEnv[name];
    }
    fs.rmSync(failedAudioDir, { recursive: true, force: true });
  });

  /** Press record, dictate for RECORDED_MS, upload TOTAL_CHUNKS chunks at Stop, finish. */
  async function dictate(): Promise<ReturnType<typeof request>> {
    const start = await request(app).post('/api/recordings/start').send({});
    expect(start.status).toBe(200);
    const id = start.body.id as string;
    for (let i = 0; i < TOTAL_CHUNKS; i += 1) {
      const chunk = Buffer.alloc(2400, i);
      const stream = await request(app)
        .post(`/api/recordings/${id}/stream`)
        .set('content-type', 'application/octet-stream')
        .send(chunk);
      expect(stream.status).toBe(200);
    }
    clock += RECORDED_MS;
    return request(app).post(`/api/recordings/${id}/finish`).send({});
  }

  it('retries once with the whole recording and keeps the full transcript when the retry covers it', async () => {
    xai = await fakeXai([
      { text: 'okay so actually two things now I am attaching', duration: 56.704 },
      { text: 'okay so actually two things now '.repeat(80).trim(), duration: 191.2 },
    ]);
    setEnv('XAI_STT_URL', xai.url);

    const res = await dictate();

    expect(res.status).toBe(200);
    expect(xai.calls).toBe(2);
    expect(res.body.status).toBe('completed');
    expect(res.body.raw_text.length).toBeGreaterThan(2000);
    expect(fs.readdirSync(failedAudioDir)).toEqual([]);
  });

  it('refuses to call a short decode complete, keeps the audio, and keeps the words it did hear', async () => {
    xai = await fakeXai([{ text: 'okay so actually two things now I am attaching', duration: 56.704 }]);
    setEnv('XAI_STT_URL', xai.url);

    const res = await dictate();

    expect(res.status).toBe(200);
    expect(xai.calls).toBe(2); // one retry, then it gives up
    expect(res.body.status).toBe('error');
    // The partial words stay in the row: the owner can still recover them from history.
    expect(res.body.raw_text).toBe('okay so actually two things now I am attaching');
    const kept = fs.readdirSync(failedAudioDir);
    expect(kept.filter((name) => name.endsWith('.audio'))).toHaveLength(1);
    const meta = JSON.parse(
      fs.readFileSync(
        path.join(
          failedAudioDir,
          kept.find((name) => name.endsWith('.json')) as string,
        ),
        'utf8',
      ),
    ) as { reason: string; durationMs: number };
    expect(meta.reason).toBe('short-decode');
    expect(meta.durationMs).toBe(RECORDED_MS);
  });

  it('does no retry and answers complete when the decode covers the recording', async () => {
    xai = await fakeXai([{ text: 'the whole dictation', duration: 191.2 }]);
    setEnv('XAI_STT_URL', xai.url);

    const res = await dictate();

    expect(xai.calls).toBe(1);
    expect(res.body.status).toBe('completed');
    expect(res.body.raw_text).toBe('the whole dictation');
    expect(fs.readdirSync(failedAudioDir)).toEqual([]);
  });

  it('keeps the first attempt when the retry is no better and no longer', async () => {
    xai = await fakeXai([
      { text: 'first attempt, longer words here', duration: 56.7 },
      { text: 'retry', duration: 57.0 },
    ]);
    setEnv('XAI_STT_URL', xai.url);

    const res = await dictate();

    expect(xai.calls).toBe(2);
    expect(res.body.raw_text).toBe('first attempt, longer words here');
    expect(res.body.status).toBe('error');
  });

  it('never flags a tier that does not report a decoded duration (the fallbacks)', async () => {
    xai = await fakeXai([{ text: 'local asr answered this' }]); // no duration field
    setEnv('XAI_STT_URL', xai.url);

    const res = await dictate();

    expect(xai.calls).toBe(1);
    expect(res.body.status).toBe('completed');
    expect(fs.readdirSync(failedAudioDir)).toEqual([]);
  });
});
