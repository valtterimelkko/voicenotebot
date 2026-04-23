import { Router } from 'express';
import { DB } from '../db';

export function transcriptsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  router.get('/search', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  router.get('/:id', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  router.delete('/:id', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  return router;
}
