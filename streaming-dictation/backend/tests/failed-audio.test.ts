import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { keepFailedAudio, pruneFailedAudio, sniffContainer } from '../src/services/failed-audio';

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
const OGG = Buffer.from('OggS\0rest');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A rest')]);

describe('failed-audio', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failed-audio-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sniffs the container from the first bytes', () => {
    expect(sniffContainer(WEBM)).toBe('webm');
    expect(sniffContainer(OGG)).toBe('ogg');
    expect(sniffContainer(MP4)).toBe('mp4');
    expect(sniffContainer(Buffer.from('RIFF....WAVE'))).toBe('wav');
    expect(sniffContainer(Buffer.from([9, 9, 9, 9]))).toBe('unknown');
  });

  it('keeps the audio as received and a metadata file that shows where the header chunk sat', () => {
    const tail = Buffer.from([7, 7, 7]);
    const kept = keepFailedAudio({
      dir,
      id: 'rec-1',
      chunks: [tail, WEBM, tail],
      durationMs: 67001,
      sttModel: 'gpt-transcribe',
      reason: 'no-words',
      now: new Date('2026-10-30T12:53:34Z'),
    });
    expect(kept).not.toBeNull();
    const audio = fs.readFileSync(path.join(dir, 'rec-1.audio'));
    expect(audio.equals(Buffer.concat([tail, WEBM, tail]))).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'rec-1.json'), 'utf8'));
    expect(meta).toMatchObject({
      id: 'rec-1',
      keptAt: '2026-10-30T12:53:34.000Z',
      durationMs: 67001,
      sttModel: 'gpt-transcribe',
      reason: 'no-words',
      chunkCount: 3,
      chunkSizes: [3, 7, 3],
      totalBytes: 13,
      container: 'unknown',
      headerChunks: [{ index: 1, container: 'webm' }],
    });
    expect(fs.statSync(path.join(dir, 'rec-1.audio')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(dir).mode & 0o077).toBe(0);
  });

  it('refuses an id that could leave the folder', () => {
    expect(
      keepFailedAudio({ dir, id: '../x', chunks: [WEBM], durationMs: 1, sttModel: '', reason: 'stt-failed' }),
    ).toBeNull();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('never throws when the folder cannot be written', () => {
    const blocked = path.join(dir, 'file');
    fs.writeFileSync(blocked, '');
    expect(
      keepFailedAudio({ dir: path.join(blocked, 'sub'), id: 'r', chunks: [WEBM], durationMs: 1, sttModel: '', reason: 'no-words' }),
    ).toBeNull();
  });

  it('prunes kept recordings older than the window and leaves newer ones', () => {
    const old = new Date('2026-10-29T10:00:00Z');
    const fresh = new Date('2026-10-30T12:00:00Z');
    keepFailedAudio({ dir, id: 'old', chunks: [WEBM], durationMs: 1, sttModel: '', reason: 'no-words', now: old });
    keepFailedAudio({ dir, id: 'new', chunks: [WEBM], durationMs: 1, sttModel: '', reason: 'no-words', now: fresh });
    for (const name of ['old.audio', 'old.json']) fs.utimesSync(path.join(dir, name), old, old);
    const removed = pruneFailedAudio(dir, 24 * 60 * 60 * 1000, new Date('2026-10-30T13:00:00Z'));
    expect(removed).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual(['new.audio', 'new.json']);
  });

  it('prunes nothing when the folder does not exist', () => {
    expect(pruneFailedAudio(path.join(dir, 'missing'), 1000)).toBe(0);
  });
});
