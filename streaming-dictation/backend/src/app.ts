import express from 'express';
import path from 'path';
import './types'; // ambient Request.requestId augmentation
import type { DB } from './db';
import { sessionMiddleware, requireAuth } from './middleware/auth';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { transcriptsRouter } from './routes/transcripts';
import { settingsRouter } from './routes/settings';
import { recordingsRouter } from './routes/recordings';
import { healthRouter } from './routes/health';

export interface CreateAppOptions {
  /** Serve the built frontend (static + SPA fallback). Production only. */
  serveStatic?: boolean;
}

/**
 * Single source of truth for the Express stack.
 *
 * Production (`index.ts`) and integration tests share this so that
 * middleware ordering, error handling, and routing are exercised
 * identically in both. Listens/signal-handling/retention stay in index.ts.
 */
export function createApp(db: DB, opts: CreateAppOptions = {}): express.Application {
  const app = express();

  app.set('trust proxy', 1);

  // Observability: tag every request with a correlatable id and a finish log
  // line. Registered first so even body-parse / session errors are covered.
  app.use(requestId());
  app.use(requestLogger());

  app.use(express.json({ limit: '50mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));
  app.use(sessionMiddleware());
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.locals.db = db;

  app.use('/auth', authRouter(db));
  app.use('/api/recordings', requireAuth, recordingsRouter(db));
  app.use('/api/transcripts', requireAuth, transcriptsRouter(db));
  app.use('/api/settings', requireAuth, settingsRouter(db));
  app.use('/', healthRouter(db));

  if (opts.serveStatic) {
    const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
      if (req.accepts('html') || req.path.includes('.')) {
        res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
          if (err) next(err);
        });
      } else {
        next();
      }
    });
  }

  // Last-resort error handler — MUST be registered after all routes/middleware.
  app.use(errorHandler());

  return app;
}
