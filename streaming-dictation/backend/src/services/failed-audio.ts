import fs from 'fs';
import path from 'path';

/**
 * Failed dictations keep their audio for a day (owner, 2026-10-30): production otherwise keeps no audio, so a
 * dictation that came back with no words could never be replayed. Only failures are kept, owner-only (0700/0600),
 * and pruned after the window. The metadata lists each chunk's size and which chunks open with a container header:
 * a header anywhere but chunk 0 means the chunks arrived out of order.
 */

export type FailedAudioReason = 'no-words' | 'stt-failed';

export interface KeepFailedAudioInput {
  dir: string;
  id: string;
  chunks: Buffer[];
  durationMs: number;
  sttModel: string;
  reason: FailedAudioReason;
  now?: Date;
}

export const FAILED_AUDIO_WINDOW_MS = 24 * 60 * 60 * 1000;

const SAFE_ID = /^[A-Za-z0-9-]+$/;

/** The container a chunk opens with, from its magic bytes. */
export function sniffContainer(bytes: Buffer): string {
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (bytes.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF') return 'wav';
  return 'unknown';
}

/** Writes `<id>.audio` and `<id>.json`; returns the audio path, or null. Never throws: diagnosis must not break a finish. */
export function keepFailedAudio(input: KeepFailedAudioInput): string | null {
  if (!SAFE_ID.test(input.id)) return null;
  try {
    fs.mkdirSync(input.dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(input.dir, 0o700);
    const audioPath = path.join(input.dir, `${input.id}.audio`);
    const all = Buffer.concat(input.chunks);
    fs.writeFileSync(audioPath, all, { mode: 0o600 });
    const meta = {
      id: input.id,
      keptAt: (input.now ?? new Date()).toISOString(),
      durationMs: input.durationMs,
      sttModel: input.sttModel,
      reason: input.reason,
      chunkCount: input.chunks.length,
      chunkSizes: input.chunks.map((chunk) => chunk.length),
      totalBytes: all.length,
      container: sniffContainer(all),
      headerChunks: input.chunks
        .map((chunk, index) => ({ index, container: sniffContainer(chunk) }))
        .filter((entry) => entry.container !== 'unknown'),
    };
    fs.writeFileSync(path.join(input.dir, `${input.id}.json`), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
    return audioPath;
  } catch {
    return null;
  }
}

/** Removes kept files older than the window; returns how many were removed. */
export function pruneFailedAudio(dir: string, maxAgeMs: number = FAILED_AUDIO_WINDOW_MS, now: Date = new Date()): number {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.audio') && !name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      if (now.getTime() - fs.statSync(file).mtimeMs > maxAgeMs) {
        fs.rmSync(file);
        removed += 1;
      }
    } catch {
      // gone already
    }
  }
  return removed;
}
