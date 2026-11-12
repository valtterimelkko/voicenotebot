/**
 * `/finish` coverage (owner, 2026-11-11; round 2, 2026-11-12).
 *
 * A 3 min 15 s Android dictation came back as 739 characters — a bit more than a quarter of it — with no error
 * anywhere, because xAI answers 200 with the part of the audio it managed to decode. Round 1 refused that as an
 * `error`; round 2 makes the retry meaningful (ffmpeg re-decodes the recording, ≤ 90 s segments) and, when the audio
 * itself is short, keeps the words with one plain note line instead of the apps' "No words were heard".
 *
 * The fake xAI endpoint answers from a queue and records what it received, so both the transcript and the declared
 * audio format are observable.
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

vi.mock('../src/services/audio-normalise', () => ({
  decodeToSegments: vi.fn(),
  AudioDecodeError: class AudioDecodeError extends Error {},
}));

import { recordingsRouter } from '../src/routes/recordings';
import { decodeToSegments, AudioDecodeError } from '../src/services/audio-normalise';

const mockedDecode = vi.mocked(decodeToSegments);

interface FakeXai {
  url: string;
  calls: number;
  bodies: string[];
  close: () => void;
}

/** A fake xAI STT endpoint that answers each call from `answers` (the last one repeats). */
function fakeXai(answers: Array<{ text: string; duration?: number }>): Promise<FakeXai> {
  const state: FakeXai = { url: '', calls: 0, bodies: [], close: () => {} };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const answer = answers[Math.min(state.calls, answers.length - 1)];
      state.calls += 1;
      state.bodies.push(Buffer.concat(chunks).toString('latin1'));
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
const NOTE_PREFIX = '[Dictation cut short:';

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

  beforeEach(() => {
    vi.clearAllMocks();
    clock = 1_000_000;
    failedAudioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-coverage-'));
    setEnv('LOCAL_ASR_URL', 'http://127.0.0.1:9/asr'); // nothing listens: the local tier must not mask a failure
    config.xaiApiKey = 'test-xai-key';
    config.failedAudioDir = failedAudioDir;
    config.serviceToken = '';
    config.forceAudioNormalise = false;
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

  function keptMeta(): { reason: string; durationMs: number } {
    const names = fs.readdirSync(failedAudioDir);
    const json = names.find((name) => name.endsWith('.json'));
    expect(json).toBeDefined();
    return JSON.parse(fs.readFileSync(path.join(failedAudioDir, json as string), 'utf8')) as {
      reason: string;
      durationMs: number;
    };
  }

  it('re-decodes with ffmpeg, transcribes the segments in order and returns the whole dictation', async () => {
    xai = await fakeXai([
      { text: 'okay so actually two things now I am attaching', duration: 56.704 }, // the direct attempt
      { text: 'Part one words.', duration: 89.9 }, // converted segment 0
      { text: 'Part two words.', duration: 89.9 }, // converted segment 1
      { text: 'Part three words.', duration: 15.2 }, // converted segment 2
    ]);
    setEnv('XAI_STT_URL', xai.url);
    mockedDecode.mockResolvedValue({
      segments: [Buffer.from('seg0'), Buffer.from('seg1'), Buffer.from('seg2')],
      decodedSec: 195.0,
    });

    const res = await dictate();

    expect(res.status).toBe(200);
    expect(mockedDecode).toHaveBeenCalledTimes(1);
    expect(xai.calls).toBe(4); // direct, then one request per segment
    expect(res.body.raw_text).toBe('Part one words. Part two words. Part three words.');
    expect(res.body.status).toBe('completed');
    expect(res.body.cleaned_text).not.toContain(NOTE_PREFIX); // nothing was lost, so no note
    expect(fs.readdirSync(failedAudioDir)).toEqual([]);
    // The segments go up as plain WAV, not as the webm they are not.
    expect(xai.bodies.slice(1).every((body) => body.includes('audio/wav') && body.includes('audio.wav'))).toBe(true);
  });

  it('keeps the words and adds one plain note when ffmpeg also decodes the audio short', async () => {
    xai = await fakeXai([{ text: 'okay so actually two things now I am attaching', duration: 56.704 }]);
    setEnv('XAI_STT_URL', xai.url);
    mockedDecode.mockResolvedValue({ segments: [Buffer.from('seg0')], decodedSec: 56.8 });

    const res = await dictate();

    expect(res.status).toBe(200);
    expect(xai.calls).toBe(1); // the audio is short: no upstream retry at all
    expect(res.body.status).toBe('completed');
    expect(res.body.raw_text).toBe('okay so actually two things now I am attaching');
    expect(res.body.cleaned_text).toContain(`${NOTE_PREFIX} only the first 0:57 of 3:16 was transcribed.`);
    expect(keptMeta().reason).toBe('short-decode');
    expect(keptMeta().durationMs).toBe(RECORDED_MS);
  });

  it('never adds the note to raw_text, and adds it only once', async () => {
    xai = await fakeXai([{ text: 'half a dictation', duration: 10 }]);
    setEnv('XAI_STT_URL', xai.url);
    mockedDecode.mockResolvedValue({ segments: [Buffer.from('seg0')], decodedSec: 10 });

    const res = await dictate();

    expect(res.body.raw_text).toBe('half a dictation');
    expect(res.body.cleaned_text.match(/Dictation cut short/g)).toHaveLength(1);
  });

  it('falls back to one plain retry when ffmpeg is unusable, and still prefers what covers more', async () => {
    xai = await fakeXai([
      { text: 'first attempt short', duration: 56.7 },
      { text: 'retry covers everything', duration: 191.2 },
    ]);
    setEnv('XAI_STT_URL', xai.url);
    mockedDecode.mockRejectedValue(new AudioDecodeError('ffmpeg is not installed'));

    const res = await dictate();

    expect(xai.calls).toBe(2);
    expect(res.body.status).toBe('completed');
    expect(res.body.raw_text).toBe('retry covers everything');
    expect(res.body.cleaned_text).not.toContain(NOTE_PREFIX);
  });

  it('adds the note, not an error, when both the retry and the audio stay short and ffmpeg died', async () => {
    xai = await fakeXai([{ text: 'first attempt short', duration: 56.7 }]);
    setEnv('XAI_STT_URL', xai.url);
    mockedDecode.mockRejectedValue(new AudioDecodeError('ffmpeg exploded'));

    const res = await dictate();

    expect(xai.calls).toBe(2);
    expect(res.body.status).toBe('completed');
    expect(res.body.cleaned_text).toContain(NOTE_PREFIX);
    expect(keptMeta().reason).toBe('short-decode');
  });

  it('does no conversion and no note when the decode covers the recording', async () => {
    xai = await fakeXai([{ text: 'the whole dictation', duration: 191.2 }]);
    setEnv('XAI_STT_URL', xai.url);

    const res = await dictate();

    expect(mockedDecode).not.toHaveBeenCalled();
    expect(xai.calls).toBe(1);
    expect(res.body.status).toBe('completed');
    expect(res.body.raw_text).toBe('the whole dictation');
    expect(res.body.cleaned_text).not.toContain(NOTE_PREFIX);
    expect(fs.readdirSync(failedAudioDir)).toEqual([]);
  });

  it('never flags a tier that does not report a decoded duration (the fallbacks)', async () => {
    xai = await fakeXai([{ text: 'local asr answered this' }]); // no duration field
    setEnv('XAI_STT_URL', xai.url);

    const res = await dictate();

    expect(mockedDecode).not.toHaveBeenCalled();
    expect(res.body.status).toBe('completed');
    expect(res.body.cleaned_text).not.toContain(NOTE_PREFIX);
    expect(fs.readdirSync(failedAudioDir)).toEqual([]);
  });

  it('converts even when the first decode was fine, when the flag forces it (lab proof path)', async () => {
    config.forceAudioNormalise = true;
    xai = await fakeXai([{ text: 'Converted whole dictation.', duration: 195.0 }]);
    setEnv('XAI_STT_URL', xai.url);
    mockedDecode.mockResolvedValue({ segments: [Buffer.from('seg0')], decodedSec: 195.0 });

    const res = await dictate();

    expect(mockedDecode).toHaveBeenCalledTimes(1);
    expect(xai.calls).toBe(1); // no direct attempt: the converted audio is the attempt
    expect(res.body.raw_text).toBe('Converted whole dictation.');
    expect(res.body.status).toBe('completed');
    expect(res.body.cleaned_text).not.toContain(NOTE_PREFIX);
  });
});
