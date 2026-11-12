/**
 * Re-decode a recording with ffmpeg (round 2, owner 2026-11-12: "a long Android dictation comes back whole").
 *
 * A short decode is retried on *different bytes*: ffmpeg reads the whole recording, resamples to 16 kHz mono PCM
 * WAV and slices it into ≤ 90 s parts, so no single upstream request carries a long or unusual container. WAV was
 * chosen over FLAC/Opus because it has no container to misread; it was proven on the lab against xAI and against
 * the host's local ASR (both transcribe a 90 s part whole).
 *
 * ffmpeg's own decoded duration (`-progress pipe:1`) is the important second number: it tells a short *upload*
 * (the phone side — nothing upstream can recover it) apart from a partial decode of a complete file.
 *
 * This runs only after a short decode, with a timeout, in a private temp dir that is always removed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** ffmpeg as installed on this host; `FFMPEG_PATH` overrides it. */
export const DEFAULT_FFMPEG_PATH = '/usr/bin/ffmpeg';

/** One upstream request never carries more than this much audio. */
export const DEFAULT_SEGMENT_SEC = 90;

/** A whole recording decodes in about a second; a hung ffmpeg must not hold a finish open. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** ffmpeg could not give us usable audio (missing, crashed, timed out, or produced nothing). */
export class AudioDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioDecodeError';
  }
}

export interface DecodedAudio {
  /** 16 kHz mono PCM WAV parts, in recording order. */
  segments: Buffer[];
  /** Seconds of audio ffmpeg actually decoded. */
  decodedSec: number;
}

/** How the segment files are named inside the temp dir; also the discovery pattern. */
const PART_PATTERN = /^part\d{3}\.wav$/;

export type FfmpegRunner = (binary: string, args: string[], cwd: string, timeoutMs: number) => Promise<string>;

export interface DecodeOptions {
  ffmpegPath?: string;
  segmentSec?: number;
  timeoutMs?: number;
  /** Injected in tests: writes the parts into `cwd` and returns ffmpeg's `-progress` output. */
  run?: FfmpegRunner;
}

/**
 * The seconds ffmpeg decoded, from its `-progress pipe:1` stream (`out_time_us`, microseconds). The last complete
 * value is the whole file: earlier ones are intermediate reports.
 */
export function decodedSecondsFromProgress(output: string): number | undefined {
  let last: number | undefined;
  for (const line of output.split('\n')) {
    const match = /^out_time_us=(\d+)\s*$/.exec(line.trim());
    if (match === null) continue;
    const micros = Number(match[1]);
    if (Number.isFinite(micros) && micros >= 0) last = micros / 1_000_000;
  }
  return last;
}

/** Runs ffmpeg, collecting `-progress` output from stdout; rejects on a non-zero exit or the timeout. */
const runFfmpeg: FfmpegRunner = (binary, args, cwd, timeoutMs) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (error: Error | null, value?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === null) resolve(value ?? '');
      else reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new AudioDecodeError(`ffmpeg timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (data: Buffer) => {
      out += data.toString('utf8');
    });
    child.stderr.on('data', (data: Buffer) => {
      err += data.toString('utf8');
    });
    child.on('error', (error: Error) => {
      finish(new AudioDecodeError(`ffmpeg could not start: ${error.message}`));
    });
    child.on('close', (code: number | null) => {
      if (code === 0) finish(null, out);
      else finish(new AudioDecodeError(`ffmpeg exited ${String(code)}: ${err.trim().slice(0, 200)}`));
    });
  });

/**
 * Decode `audio` to ≤ `segmentSec` WAV parts. Throws `AudioDecodeError` when ffmpeg is unusable, so the caller can
 * fall back to its previous behaviour instead of failing the dictation.
 */
export async function decodeToSegments(audio: Buffer, opts: DecodeOptions = {}): Promise<DecodedAudio> {
  const ffmpegPath = opts.ffmpegPath ?? DEFAULT_FFMPEG_PATH;
  const segmentSec = opts.segmentSec ?? DEFAULT_SEGMENT_SEC;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = opts.run ?? runFfmpeg;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-audio-'));
  try {
    fs.writeFileSync(path.join(dir, 'input'), audio, { mode: 0o600 });
    const progress = await run(
      ffmpegPath,
      [
        '-hide_banner',
        '-v', 'error',
        '-y',
        '-i', 'input',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'pcm_s16le',
        '-f', 'segment',
        '-segment_time', String(segmentSec),
        '-reset_timestamps', '1',
        '-progress', 'pipe:1',
        '-nostats',
        'part%03d.wav',
      ],
      dir,
      timeoutMs,
    );
    const decodedSec = decodedSecondsFromProgress(progress);
    if (decodedSec === undefined) throw new AudioDecodeError('ffmpeg reported no decoded duration');
    const parts = fs.readdirSync(dir).filter((name) => PART_PATTERN.test(name)).sort();
    if (parts.length === 0 || decodedSec <= 0) {
      throw new AudioDecodeError('ffmpeg decoded no audio');
    }
    return { segments: parts.map((name) => fs.readFileSync(path.join(dir, name))), decodedSec };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
