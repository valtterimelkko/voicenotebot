import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';

/**
 * Emit one structured line per completed request (method, path, status,
 * duration, requestId) when the response finishes. Registered before routes so
 * the finish hook is attached in time to capture every response, including
 * those produced by the error handler.
 */
export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info({
        event: 'request',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        requestId: req.requestId,
        durationMs: Date.now() - start,
      });
    });
    next();
  };
}
