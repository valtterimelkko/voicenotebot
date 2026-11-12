/**
 * The recovery attempt behind a short transcript (round 2, owner 2026-11-12).
 *
 * A second identical request decodes the same part of the file again, so the retry changes the bytes instead:
 * ffmpeg re-decodes the whole recording to 16 kHz mono WAV, and the parts are transcribed in order and stitched.
 * ffmpeg also reports how much audio it decoded, which separates the two cases:
 *
 * - ffmpeg decodes (almost) everything → the upstream lost part of a complete file, and the conversion recovers it;
 * - ffmpeg decodes only what the upstream did → the audio itself is short (the phone recorded or uploaded less than
 *   it captured), and no upstream call can help.
 *
 * ffmpeg being unavailable is never fatal: the caller keeps its previous behaviour.
 */
import { config } from '../config';
import { decodeToSegments, AudioDecodeError, type DecodeOptions } from './audio-normalise';
import { decodedShort } from './stt-coverage';
import { transcribeWithFallback, WAV_FORMAT, type STTResult, type SttLanguage } from './stt';

export type ConvertedOutcome =
  | {
      kind: 'converted';
      result: STTResult;
      /** Seconds of audio the converted parts covered, when every part reported one. */
      decodedSec: number | undefined;
    }
  | { kind: 'audio-short'; decodedSec: number }
  /** ffmpeg itself was unusable: the caller keeps its previous behaviour. */
  | { kind: 'unavailable'; error: string }
  /** ffmpeg produced parts but transcribing one of them failed: the caller keeps the first attempt. */
  | { kind: 'parts-failed'; error: string };

/** How many parts may be in flight at once: four kept a 3 min dictation to ~10 s instead of ~40 s. */
export const MAX_PARALLEL_PARTS = 4;

/**
 * Decode the recording with ffmpeg and transcribe the parts in order, unless ffmpeg shows the audio itself is short.
 * `expectedSec` is what the recording should hold; `decodeOptions` exists so tests can drive the decode.
 */
export async function transcribeConverted(
  chunks: Buffer[],
  prompt: string | undefined,
  language: SttLanguage,
  expectedSec: number,
  decodeOptions: DecodeOptions = {},
): Promise<ConvertedOutcome> {
  let decoded;
  try {
    decoded = await decodeToSegments(Buffer.concat(chunks), {
      ffmpegPath: config.ffmpegPath,
      ...decodeOptions,
    });
  } catch (err) {
    const error = err instanceof AudioDecodeError ? err.message : err instanceof Error ? err.message : String(err);
    return { kind: 'unavailable', error };
  }

  // Nothing upstream can recover audio the file does not contain.
  if (decodedShort(decoded.decodedSec, expectedSec)) {
    return { kind: 'audio-short', decodedSec: decoded.decodedSec };
  }

  // The parts go up concurrently, a pool of MAX_PARALLEL_PARTS at a time: sequential requests made the owner wait
  // roughly the length of his own dictation after Stop. Results are written back by part index, so the transcript
  // reads in the order he spoke whatever order the answers arrive in.
  const parts: Array<STTResult | undefined> = new Array(decoded.segments.length).fill(undefined);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < decoded.segments.length; index = next++) {
      const segment = decoded.segments[index];
      if (segment === undefined) continue;
      parts[index] = await transcribeWithFallback([segment], prompt, language, WAV_FORMAT);
    }
  };
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(MAX_PARALLEL_PARTS, decoded.segments.length) }, worker),
  );
  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure !== undefined && failure.status === 'rejected') {
    // One part failing must never turn a dictation that produced words into a failure: say so and let the caller
    // keep what the first attempt heard (round 3, reviewer findings 2-3).
    const reason: unknown = failure.reason;
    return { kind: 'parts-failed', error: reason instanceof Error ? reason.message : String(reason) };
  }

  const texts = parts.map((part) => part?.text.trim() ?? '');
  let model = '';
  let usedFallback = false;
  let covered = 0;
  let allReported = parts.every((part) => part !== undefined && part.decodedSec !== undefined);
  for (const part of parts) {
    if (part === undefined) continue;
    model = part.model;
    usedFallback = usedFallback || part.usedFallback;
    if (part.decodedSec === undefined) allReported = false;
    else covered += part.decodedSec;
  }

  return {
    kind: 'converted',
    result: {
      text: texts.filter((text) => text !== '').join(' '),
      model,
      usedFallback,
      ...(allReported ? { decodedSec: covered } : {}),
    },
    decodedSec: allReported ? covered : undefined,
  };
}
