import { Router } from 'express';
import { DB } from '../db';

export function settingsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  router.put('/', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  return router;
}
