import { Router } from 'express';
import type { DB } from '../db';

export function healthRouter(db: DB): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    // A live DB connection is required for every real request. A process whose
    // DB handle was closed (e.g. a botched shutdown) must not report healthy.
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({
        status: 'degraded',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
