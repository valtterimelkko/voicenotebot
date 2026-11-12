/**
 * The recovery attempt behind a short transcript (round 3, owner 2026-11-12).
 *
 * The ≤ 90 s parts go up **concurrently** (at most 4 in flight) — four sequential requests made the owner wait ~40 s
 * after Stop for a 3 min dictation — and the transcript is stitched **by part index**, so the text always reads in the
 * order he spoke whatever order the answers arrive in.
 *
 * A part whose fallback chain throws must never turn a dictation that did produce words into a failure: the caller
 * keeps the first (short) attempt and adds the cut-short note instead. The outcome says so explicitly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/audio-normalise', () => ({
  decodeToSegments: vi.fn(),
  AudioDecodeError: class AudioDecodeError extends Error {},
}));

vi.mock('../src/services/stt', () => ({
  transcribeWithFallback: vi.fn(),
  WAV_FORMAT: { type: 'audio/wav', name: 'audio.wav' },
}));

import { decodeToSegments } from '../src/services/audio-normalise';
import { transcribeWithFallback, WAV_FORMAT } from '../src/services/stt';
import { transcribeConverted } from '../src/services/stt-recovery';

const mockedDecode = vi.mocked(decodeToSegments);
const mockedTranscribe = vi.mocked(transcribeWithFallback);

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const threeParts = (): void => {
  mockedDecode.mockResolvedValue({
    segments: [Buffer.from('part-0'), Buffer.from('part-1'), Buffer.from('part-2')],
    decodedSec: 195,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('transcribeConverted: concurrent parts, stitched by index', () => {
  it('starts every part before any answer arrives, and stitches them in index order', async () => {
    threeParts();
    const parts = [deferred<string>(), deferred<string>(), deferred<string>()];
    let started = 0;
    mockedTranscribe.mockImplementation((chunks) => {
      const index = Number(chunks[0]?.toString().slice(-1));
      started += 1;
      return parts[index]?.promise.then((text) => ({
        text,
        model: 'grok-voice-transcribe-2.0',
        usedFallback: false,
        decodedSec: 90,
      })) as never;
    });

    const result = transcribeConverted([Buffer.from('recording')], undefined, 'en', 195);

    // All three requests are in flight before any of them answers: that is the concurrency the owner waits on.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(3);

    // They answer out of order — last part first.
    parts[2]?.resolve('words 2');
    parts[0]?.resolve('words 0');
    parts[1]?.resolve('words 1');

    const outcome = await result;
    expect(outcome.kind).toBe('converted');
    if (outcome.kind !== 'converted') throw new Error('unreachable');
    expect(outcome.result.text).toBe('words 0 words 1 words 2');
    expect(outcome.result.decodedSec).toBe(270);
    expect(mockedTranscribe).toHaveBeenCalledTimes(3);
    // Every part goes up as plain WAV.
    for (const call of mockedTranscribe.mock.calls) expect(call[3]).toEqual(WAV_FORMAT);
  });

  it('never runs more than four parts at once', async () => {
    mockedDecode.mockResolvedValue({
      segments: [0, 1, 2, 3, 4, 5].map((i) => Buffer.from(`part-${i}`)),
      decodedSec: 540,
    });
    let inFlight = 0;
    let peak = 0;
    mockedTranscribe.mockImplementation(async (chunks) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { text: chunks[0]?.toString() ?? '', model: 'm', usedFallback: false, decodedSec: 90 };
    });

    const outcome = await transcribeConverted([Buffer.from('recording')], undefined, 'en', 540);

    expect(peak).toBe(4);
    if (outcome.kind !== 'converted') throw new Error('unreachable');
    expect(outcome.result.text).toBe('part-0 part-1 part-2 part-3 part-4 part-5');
  });

  it('reports a failing part instead of blowing up, so the caller can keep the first attempt', async () => {
    threeParts();
    mockedTranscribe.mockImplementation(async (chunks) => {
      const index = Number(chunks[0]?.toString().slice(-1));
      if (index === 1) throw new Error('xAI STT HTTP 503: upstream shutdown');
      return { text: `words ${index}`, model: 'm', usedFallback: false, decodedSec: 90 };
    });

    const outcome = await transcribeConverted([Buffer.from('recording')], undefined, 'en', 195);

    expect(outcome.kind).toBe('parts-failed');
    if (outcome.kind !== 'parts-failed') throw new Error('unreachable');
    expect(outcome.error).toContain('503');
  });

  it('still reports a short upload rather than transcribing it', async () => {
    mockedDecode.mockResolvedValue({ segments: [Buffer.from('part-0')], decodedSec: 56.8 });

    const outcome = await transcribeConverted([Buffer.from('recording')], undefined, 'en', 195.6);

    expect(outcome).toEqual({ kind: 'audio-short', decodedSec: 56.8 });
    expect(mockedTranscribe).not.toHaveBeenCalled();
  });

  it('reports ffmpeg being unusable without trying any part', async () => {
    const { AudioDecodeError } = await import('../src/services/audio-normalise');
    mockedDecode.mockRejectedValue(new AudioDecodeError('ffmpeg exited 1: invalid data'));

    const outcome = await transcribeConverted([Buffer.from('recording')], undefined, 'en', 195);

    expect(outcome.kind).toBe('unavailable');
    expect(mockedTranscribe).not.toHaveBeenCalled();
  });
});
