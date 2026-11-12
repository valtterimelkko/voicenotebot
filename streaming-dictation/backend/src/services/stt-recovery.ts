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
  | { kind: 'unavailable'; error: string };

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

  const texts: string[] = [];
  let model = '';
  let usedFallback = false;
  let covered = 0;
  let allReported = true;
  // In order, one request per part: the transcript must read in the order the owner spoke.
  for (const segment of decoded.segments) {
    const part = await transcribeWithFallback([segment], prompt, language, WAV_FORMAT);
    texts.push(part.text.trim());
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
