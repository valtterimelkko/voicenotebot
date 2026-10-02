import { Router, Request, Response } from 'express';
import { DB } from '../db';
// deliberately NOT imported from the service modules: those construct API
// clients at import time, which breaks client-free test contexts
import { CLEANUP_MODEL, CLEANUP_PROVIDER, STT_MODEL } from '../services/models';

interface SettingsRow {
  default_cleanup_model: string;
  retention_days: number;
  stt_vocabulary: string;
}

export function settingsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const row = db.prepare(
      'SELECT default_cleanup_model, retention_days, stt_vocabulary FROM user_settings WHERE id = 1'
    ).get() as SettingsRow | undefined;
    // effective_* fields report what the code actually runs (single source of
    // truth: the service constants), not what the settings row claims — the
    // UI must not silently drift from reality when a constant changes.
    res.json({
      ...(row ?? { default_cleanup_model: 'google/gemma-4-26b-a4b-it', retention_days: 60, stt_vocabulary: '' }),
      effective_cleanup_model: CLEANUP_MODEL,
      cleanup_provider: CLEANUP_PROVIDER,
      stt_model: STT_MODEL,
    });
  });

  router.put('/', (req: Request, res: Response) => {
    const { default_cleanup_model, retention_days, stt_vocabulary } = req.body;
    const updates: string[] = [];
    const values: unknown[] = [];

    if (default_cleanup_model !== undefined && typeof default_cleanup_model === 'string') {
      updates.push('default_cleanup_model = ?');
      values.push(default_cleanup_model);
    }
    if (retention_days !== undefined && typeof retention_days === 'number') {
      updates.push('retention_days = ?');
      values.push(retention_days);
    }
    if (stt_vocabulary !== undefined && typeof stt_vocabulary === 'string') {
      updates.push('stt_vocabulary = ?');
      values.push(stt_vocabulary);
    }

    if (updates.length > 0) {
      db.prepare(
        `UPDATE user_settings SET ${updates.join(', ')} WHERE id = 1`
      ).run(...values);
    }

    const row = db.prepare(
      'SELECT default_cleanup_model, retention_days, stt_vocabulary FROM user_settings WHERE id = 1'
    ).get() as SettingsRow;
    res.json(row);
  });

  return router;
}
