import { Router, Request, Response } from 'express';
import { DB } from '../db';

export interface TranscriptRow {
  id: string;
  created_at: string;
  expires_at: string;
  preview_text: string;
  raw_text: string;
  cleaned_text: string;
  cleanup_model: string;
  stt_model: string;
  used_fallback: number;
  duration_ms: number | null;
  status: string;
}

export function transcriptsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const transcripts = db.prepare(
      'SELECT * FROM transcripts ORDER BY created_at DESC'
    ).all() as TranscriptRow[];
    res.json({ transcripts });
  });

  router.get('/search', (req: Request, res: Response) => {
    const q = req.query.q as string;
    if (!q) {
      return res.json({ transcripts: [] });
    }
    const like = `%${q}%`;
    const transcripts = db.prepare(
      'SELECT * FROM transcripts WHERE cleaned_text LIKE ? OR raw_text LIKE ? ORDER BY created_at DESC'
    ).all(like, like) as TranscriptRow[];
    res.json({ transcripts });
  });

  router.get('/:id', (req: Request, res: Response) => {
    const transcript = db.prepare(
      'SELECT * FROM transcripts WHERE id = ?'
    ).get(req.params.id) as TranscriptRow | undefined;
    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }
    res.json(transcript);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const result = db.prepare('DELETE FROM transcripts WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Transcript not found' });
    }
    res.json({ ok: true });
  });

  return router;
}
