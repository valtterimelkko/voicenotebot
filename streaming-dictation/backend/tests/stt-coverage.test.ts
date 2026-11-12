/**
 * A long dictation that comes back whole (owner, 2026-11-11): xAI reports, next to the transcript, how many seconds
 * of audio it actually decoded. When that is materially less than what was recorded, the transcript is not the whole
 * dictation — and the backend must be able to tell, instead of storing half a prompt as a `completed` transcript.
 */
import { describe, it, expect } from 'vitest';
import { decodedShort, SHORT_DECODE_MIN_SLACK_SEC, SHORT_DECODE_RATIO } from '../src/services/stt-coverage';

describe('decodedShort', () => {
  it('fails open when the tier reported no decoded duration', () => {
    expect(decodedShort(undefined, 195.6)).toBe(false);
    expect(decodedShort(undefined, 0)).toBe(false);
  });

  it('flags the production case: 56.7 s decoded of a 195.6 s recording', () => {
    expect(decodedShort(56.704, 195.559)).toBe(true);
  });

  it('accepts a whole recording, and one that falls short only by the upload time', () => {
    expect(decodedShort(278.428, 278.428)).toBe(false);
    // Android start→finish includes the few seconds the app spends uploading at Stop.
    expect(decodedShort(191.5, 195.559)).toBe(false);
    expect(decodedShort(190.0, 195.559)).toBe(false);
  });

  it('gives short recordings the absolute slack, so a 4 s dictation is never a false alarm', () => {
    expect(decodedShort(3.648, 4.299)).toBe(false);
    expect(decodedShort(2.0, 2.4)).toBe(false);
  });

  it('flags a decode that stops a fifth into the recording', () => {
    expect(decodedShort(4.0, 90.0)).toBe(true);
    expect(decodedShort(60.0, 191.0)).toBe(true);
  });

  it('uses the documented tolerances', () => {
    expect(SHORT_DECODE_RATIO).toBe(0.1);
    expect(SHORT_DECODE_MIN_SLACK_SEC).toBe(5);
    // 100 s recording: slack 10 s, so 90 s decoded is the boundary (not short), 89 is.
    expect(decodedShort(90, 100)).toBe(false);
    expect(decodedShort(89.9, 100)).toBe(true);
  });

  it('ignores nonsense durations rather than blaming the recording', () => {
    expect(decodedShort(Number.NaN, 100)).toBe(false);
    expect(decodedShort(-1, 100)).toBe(false);
    expect(decodedShort(50, 0)).toBe(false);
  });
});
