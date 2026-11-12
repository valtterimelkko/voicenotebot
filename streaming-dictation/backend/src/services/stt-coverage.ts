/**
 * Did the transcriber hear the whole recording? (owner, 2026-11-11)
 *
 * A 3 min 15 s Android dictation came back as 739 characters — a bit more than a quarter of what was said — with no
 * error and `status: completed`. xAI had answered 200 with only the part of the audio it managed to decode, and
 * nothing in the backend compared that with the length of the recording. xAI reports the seconds it decoded
 * (`duration` in the STT answer), so the comparison is exact rather than guessed from character counts.
 *
 * The tolerances exist because `duration_ms` is the server's start→finish clock, not the audio: the Android app
 * uploads its one m4a at Stop, so a few seconds of upload ride inside it, and short dictations would otherwise trip
 * the check on a perfectly good transcript.
 */

/** How much of a recording may go undecoded before the transcript is not "the whole dictation". */
export const SHORT_DECODE_RATIO = 0.1;

/** Always-tolerated shortfall, in seconds, so a 4 s dictation with 1 s of upload time is never a false alarm. */
export const SHORT_DECODE_MIN_SLACK_SEC = 5;

/**
 * Whether an upstream decode covered materially less audio than was recorded. Fails open: a tier that reports no
 * decoded duration (local ASR, OpenAI gpt-transcribe) is never accused, and nonsense numbers change nothing.
 */
export function decodedShort(decodedSec: number | undefined, expectedSec: number): boolean {
  if (decodedSec === undefined || !Number.isFinite(decodedSec) || decodedSec < 0) return false;
  if (!Number.isFinite(expectedSec) || expectedSec <= 0) return false;
  const slack = Math.max(SHORT_DECODE_MIN_SLACK_SEC, expectedSec * SHORT_DECODE_RATIO);
  return decodedSec + slack < expectedSec;
}

/** Seconds as the owner reads them: `0:57`, `3:16`, `1:02:05`. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/**
 * The one plain line appended after cleanup when the transcript is everything that could be recovered
 * (owner, 2026-11-12: keep what was heard and say plainly that the rest is missing — never trade a partial
 * dictation for the apps' "No words were heard").
 */
export function cutShortNote(decodedSec: number, expectedSec: number): string {
  return `[Dictation cut short: only the first ${formatClock(decodedSec)} of ${formatClock(
    expectedSec,
  )} was transcribed. The rest of the recording was lost.]`;
}
