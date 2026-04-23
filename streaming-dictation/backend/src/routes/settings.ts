import { Router, Request, Response } from 'express';
import { DB } from '../db';

interface SettingsRow {
  default_cleanup_model: string;
  retention_days: number;
}

export function settingsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const row = db.prepare(
      'SELECT default_cleanup_model, retention_days FROM user_settings WHERE id = 1'
    ).get() as SettingsRow | undefined;
    res.json(row ?? { default_cleanup_model: 'kimi', retention_days: 14 });
  });

  router.put('/', (req: Request, res: Response) => {
    const { default_cleanup_model, retention_days } = req.body;
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

    if (updates.length > 0) {
      db.prepare(
        `UPDATE user_settings SET ${updates.join(', ')} WHERE id = 1`
      ).run(...values);
    }

    const row = db.prepare(
      'SELECT default_cleanup_model, retention_days FROM user_settings WHERE id = 1'
    ).get() as SettingsRow;
    res.json(row);
  });

  return router;
}
