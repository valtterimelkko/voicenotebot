import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DB } from '../db';
import { transcribeWithFallback, startSpeculativeTranscription, shouldUseSpeculative, type SpeculativeResult } from '../services/stt';
import { cleanupTranscript } from '../services/cleanup';
import { warmupConnections } from '../services/connectionPool';

interface ActiveRecording {
  chunks: Buffer[];
  startedAt: number;
  speculative: SpeculativeResult | null;
}

const activeRecordings = new Map<string, ActiveRecording>();

const SPECULATIVE_DELAY_MS = 3_000;

interface SettingsRow {
  default_cleanup_model: string;
  retention_days: number;
  stt_vocabulary: string;
}

export function recordingsRouter(db: DB): Router {
  const router = Router();

  router.post('/warmup', async (_req: Request, res: Response) => {
    await warmupConnections();
    res.json({ ok: true });
  });

  router.post('/start', (_req: Request, res: Response) => {
    const id = uuidv4();
    const recording: ActiveRecording = {
      chunks: [],
      startedAt: Date.now(),
      speculative: null,
    };
    activeRecordings.set(id, recording);

    const settings = db.prepare(
      'SELECT stt_vocabulary FROM user_settings WHERE id = 1'
    ).get() as { stt_vocabulary: string } | undefined;
    const sttVocabulary = settings?.stt_vocabulary ?? '';

    const specTimer = setTimeout(() => {
      const rec = activeRecordings.get(id);
      if (rec && rec.chunks.length > 0 && !rec.speculative) {
        rec.speculative = startSpeculativeTranscription(rec.chunks, sttVocabulary);
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

  router.post('/:id/finish', async (req: Request, res: Response) => {
    const recording = activeRecordings.get(req.params.id);
    if (!recording) {
      return res.status(404).json({ error: 'Recording session not found' });
    }

    activeRecordings.delete(req.params.id);

    const durationMs = Date.now() - recording.startedAt;

    const settings = db.prepare(
      'SELECT default_cleanup_model, retention_days, stt_vocabulary FROM user_settings WHERE id = 1'
    ).get() as SettingsRow;

    const cleanupModel = settings.default_cleanup_model as 'kimi' | 'gpt-5-nano';
    const retentionDays = settings.retention_days;
    const sttVocabulary = settings.stt_vocabulary;

    let rawText = '';
    let sttModel = '';
    let usedFallback = 0;

    try {
      const hasSpeculative =
        recording.speculative !== null &&
        shouldUseSpeculative(recording.speculative, recording.chunks.length);

      let sttResult;
      if (hasSpeculative && recording.speculative) {
        sttResult = await recording.speculative.promise;
      } else {
        sttResult = await transcribeWithFallback(recording.chunks, sttVocabulary);
      }
      rawText = sttResult.text;
      sttModel = sttResult.model;
      usedFallback = sttResult.usedFallback ? 1 : 0;
    } catch {
      rawText = '';
    }

    let cleanedText = rawText;
    if (rawText) {
      try {
        const cleanupResult = await cleanupTranscript(rawText, cleanupModel, sttVocabulary);
        cleanedText = cleanupResult.cleanedText;
      } catch {
        cleanedText = rawText;
      }
    }

    const previewText = cleanedText.slice(0, 200);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);

    db.prepare(`
      INSERT INTO transcripts (id, preview_text, raw_text, cleaned_text, cleanup_model, stt_model, used_fallback, duration_ms, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
    `).run(
      req.params.id,
      previewText,
      rawText,
      cleanedText,
      cleanupModel,
      sttModel,
      usedFallback,
      durationMs,
      expiresAt.toISOString()
    );

    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    res.json(transcript);
  });

  return router;
}
