import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DB } from '../db';
import { transcribeWithFallback, startSpeculativeTranscription, shouldUseSpeculative, type SpeculativeResult, type STTResult } from '../services/stt';
import { cutShortNote, decodedShort } from '../services/stt-coverage';
import { transcribeConverted } from '../services/stt-recovery';
import { cleanupTranscript, type CleanupModel } from '../services/cleanup';
import { warmupConnections } from '../services/connectionPool';
import { logger } from '../services/logger';
import { config } from '../config';
import { keepFailedAudio, pruneFailedAudio, type FailedAudioReason } from '../services/failed-audio';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface ActiveRecording {
  chunks: Buffer[];
  startedAt: number;
  speculative: SpeculativeResult | null;
}

const activeRecordings = new Map<string, ActiveRecording>();

const SPECULATIVE_DELAY_MS = 3_000;

/**
 * Whether the transcriber heard any words: at least two letters. A broken or silent recording can come back as a
 * lone character, and the cleanup model then answers it like a chat message instead of cleaning it (2026-10-26).
 */
export function heardWords(text: string): boolean {
  return (text.match(/\p{L}/gu) ?? []).length >= 2;
}

interface SettingsRow {
  default_cleanup_model: string;
  retention_days: number;
  stt_vocabulary: string;
  stt_language: string;
}

export function recordingsRouter(db: DB, opts: { now?: () => number } = {}): Router {
  const router = Router();
  const now = opts.now ?? Date.now;

  router.post('/warmup', async (_req: Request, res: Response) => {
    await warmupConnections();
    res.json({ ok: true });
  });

  router.post('/start', (_req: Request, res: Response) => {
    const id = uuidv4();
    const recording: ActiveRecording = {
      chunks: [],
      startedAt: now(),
      speculative: null,
    };
    activeRecordings.set(id, recording);

    const settings = db.prepare(
      'SELECT stt_vocabulary, stt_language FROM user_settings WHERE id = 1'
    ).get() as { stt_vocabulary: string; stt_language: string } | undefined;
    const sttVocabulary = settings?.stt_vocabulary ?? '';
    const sttLanguage = settings?.stt_language ?? 'en';

    const specTimer = setTimeout(() => {
      const rec = activeRecordings.get(id);
      if (rec && rec.chunks.length > 0 && !rec.speculative) {
        rec.speculative = startSpeculativeTranscription(rec.chunks, sttVocabulary, sttLanguage);
      }
    }, SPECULATIVE_DELAY_MS);
    specTimer.unref();

    res.json({ id });
  });

  router.post('/:id/stream', (req: Request, res: Response) => {
    const recording = activeRecordings.get(req.params.id);
    if (!recording) {
      return res.status(404).json({ error: 'Recording session not found' });
    }
    const chunk = req.body as Buffer;
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      return res.status(400).json({ error: 'Empty or invalid audio chunk' });
    }
    recording.chunks.push(chunk);
    res.json({ ok: true });
  });

  // Throw a recording away without transcribing it (the Wheelhouse's mic when the owner leaves mid-dictation).
  router.post('/:id/abort', (req: Request, res: Response) => {
    const existed = activeRecordings.delete(req.params.id);
    res.json({ ok: true, existed });
  });

  router.post('/:id/finish', async (req: Request, res: Response) => {
    const recording = activeRecordings.get(req.params.id);
    if (!recording) {
      return res.status(404).json({ error: 'Recording session not found' });
    }

    activeRecordings.delete(req.params.id);

    const durationMs = now() - recording.startedAt;

    const settings = db.prepare(
      'SELECT default_cleanup_model, retention_days, stt_vocabulary, stt_language FROM user_settings WHERE id = 1'
    ).get() as SettingsRow;

    const cleanupModel = settings.default_cleanup_model as CleanupModel;
    const retentionDays = settings.retention_days;
    const sttVocabulary = settings.stt_vocabulary;
    const sttLanguage = settings.stt_language ?? 'en';

    let rawText = '';
    let sttModel = '';
    let usedFallback = 0;
    let failure: FailedAudioReason | null = null;
    /** The plain line appended after cleanup when only part of the recording could be transcribed. */
    let shortNote = '';

    try {
      const hasSpeculative =
        recording.speculative !== null &&
        shouldUseSpeculative(recording.speculative, recording.chunks.length);

      const totalChunks = Math.max(1, recording.chunks.length);
      const fullSec = durationMs / 1000;
      let sttResult: STTResult | undefined;
      // The seconds of audio the current result was made from: a reused speculative pass covers only the chunks it saw.
      let expectedSec = fullSec;
      if (!config.forceAudioNormalise) {
        if (hasSpeculative && recording.speculative) {
          sttResult = await recording.speculative.promise;
          expectedSec = fullSec * (recording.speculative.chunkCount / totalChunks);
        } else {
          sttResult = await transcribeWithFallback(recording.chunks, sttVocabulary, sttLanguage);
        }
      }

      // The upstream can answer 200 with only the part of the audio it managed to decode (owner, 2026-11-11: a
      // 195 s dictation came back as 739 characters, silently). A second identical request would decode the same
      // part again, so the retry re-decodes the recording with ffmpeg and transcribes the parts (round 2).
      if (sttResult === undefined || decodedShort(sttResult.decodedSec, expectedSec)) {
        logger.warn({
          event: 'stt_short_decode_retry',
          requestId: req.requestId,
          recordingId: req.params.id,
          decodedSec: sttResult?.decodedSec,
          expectedSec: Number(expectedSec.toFixed(2)),
          textLength: sttResult?.text.length,
          forced: config.forceAudioNormalise,
        });

        const converted = await transcribeConverted(
          recording.chunks,
          sttVocabulary,
          sttLanguage,
          expectedSec,
        );
        if (converted.kind === 'audio-short') {
          // ffmpeg decoded only what the upstream did: the audio in hand is short, and the phone side owns that.
          logger.warn({
            event: 'stt_audio_short',
            requestId: req.requestId,
            recordingId: req.params.id,
            decodedSec: converted.decodedSec,
            expectedSec: Number(expectedSec.toFixed(2)),
            upstreamDecodedSec: sttResult?.decodedSec,
          });
        } else if (converted.kind === 'converted') {
          const better =
            sttResult === undefined ||
            !decodedShort(converted.decodedSec, fullSec) ||
            (sttResult.decodedSec ?? 0) < (converted.decodedSec ?? 0) ||
            converted.result.text.length > sttResult.text.length;
          if (better) {
            sttResult = converted.result;
            expectedSec = fullSec;
          }
        } else if (sttResult !== undefined) {
          // ffmpeg unusable: keep the old behaviour — one plain retry — rather than failing the dictation.
          logger.warn({
            event: 'stt_short_decode_retry_failed',
            requestId: req.requestId,
            recordingId: req.params.id,
            error: converted.error,
          });
          try {
            const retried = await transcribeWithFallback(recording.chunks, sttVocabulary, sttLanguage);
            if (
              !decodedShort(retried.decodedSec, fullSec) ||
              (retried.decodedSec ?? 0) > (sttResult.decodedSec ?? 0) ||
              retried.text.length > sttResult.text.length
            ) {
              sttResult = retried;
              expectedSec = fullSec;
            }
          } catch (retryErr) {
            logger.warn({
              event: 'stt_short_decode_retry_failed',
              requestId: req.requestId,
              recordingId: req.params.id,
              error: errMessage(retryErr),
            });
          }
        }
      }

      // Only reachable when the forced conversion path could not produce an attempt at all.
      if (sttResult === undefined) {
        sttResult = await transcribeWithFallback(recording.chunks, sttVocabulary, sttLanguage);
        expectedSec = fullSec;
      }

      rawText = sttResult.text;
      sttModel = sttResult.model;
      usedFallback = sttResult.usedFallback ? 1 : 0;
      if (!heardWords(rawText)) {
        // Nothing usable: no cleanup call, and the row is marked failed like a total STT failure.
        logger.warn({
          event: 'stt_no_words',
          requestId: req.requestId,
          recordingId: req.params.id,
          sttModel,
          rawLength: rawText.length,
        });
        rawText = '';
        failure = 'no-words';
      } else if (decodedShort(sttResult.decodedSec, expectedSec)) {
        // The words are real but they are not the dictation: keep them, keep the audio for diagnosis, and tell
        // the owner in plain words that the rest was lost (never the apps' "No words were heard").
        logger.warn({
          event: 'stt_short_decode',
          requestId: req.requestId,
          recordingId: req.params.id,
          sttModel,
          decodedSec: sttResult.decodedSec,
          expectedSec: Number(expectedSec.toFixed(2)),
          rawLength: rawText.length,
        });
        failure = 'short-decode';
        shortNote = cutShortNote(sttResult.decodedSec ?? 0, expectedSec);
      }
    } catch (err) {
      // Transcription totally failed. We still persist a row (with empty text)
      // so the user sees something happened, but it is flagged, not silent.
      rawText = '';
      failure = 'stt-failed';
      logger.error({
        event: 'stt_failed',
        requestId: req.requestId,
        recordingId: req.params.id,
        error: errMessage(err),
      });
    }

    let cleanedText = rawText;
    if (rawText) {
      try {
        const cleanupResult = await cleanupTranscript(rawText, cleanupModel, sttVocabulary);
        cleanedText = cleanupResult.cleanedText;
      } catch (err) {
        // Cleanup is best-effort: fall back to the raw text, but log it so a
        // silently degrading cleanup model never goes unnoticed.
        cleanedText = rawText;
        logger.warn({
          event: 'cleanup_failed',
          requestId: req.requestId,
          recordingId: req.params.id,
          cleanupModel,
          error: errMessage(err),
        });
      }
    }

    // The note is appended after cleanup and never handed to the cleanup model (owner, 2026-11-12).
    if (shortNote !== '') cleanedText = `${cleanedText}\n\n${shortNote}`;

    const status = rawText ? 'completed' : 'error';

    if (failure !== null && config.failedAudioDir !== '') {
      pruneFailedAudio(config.failedAudioDir);
      const kept = keepFailedAudio({
        dir: config.failedAudioDir,
        id: req.params.id,
        chunks: recording.chunks,
        durationMs,
        sttModel,
        reason: failure,
      });
      logger.warn({
        event: 'failed_audio_kept',
        requestId: req.requestId,
        recordingId: req.params.id,
        reason: failure,
        kept: kept !== null,
        chunkCount: recording.chunks.length,
      });
    }
    const previewText = cleanedText.slice(0, 200);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);

    db.prepare(`
      INSERT INTO transcripts (id, preview_text, raw_text, cleaned_text, cleanup_model, stt_model, used_fallback, duration_ms, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id,
      previewText,
      rawText,
      cleanedText,
      cleanupModel,
      sttModel,
      usedFallback,
      durationMs,
      expiresAt.toISOString(),
      status
    );

    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    res.json(transcript);
  });

  return router;
}
