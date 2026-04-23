import { Router } from 'express';
import { DB } from '../db';

export function authRouter(db: DB): Router {
  const router = Router();

  router.post('/login', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  router.post('/logout', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  router.get('/session', (_req, res) => {
    res.status(501).json({ message: 'not implemented' });
  });

  return router;
}
