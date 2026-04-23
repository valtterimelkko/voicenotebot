import { Router } from 'express';
import { DB } from '../db';

export function recordingsRouter(db: DB): Router {
  const router = Router();

  router.post('/start', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  router.post('/:id/stream', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  router.post('/:id/finish', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  return router;
}
