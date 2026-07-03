import type { ErrorRequestHandler } from 'express';
import { logger } from '../services/logger';

function statusOf(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === 'number' && Number.isInteger(s) && s >= 400 && s < 600) {
      return s;
    }
  }
  return 500;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

/**
 * Last-resort error handler. Converts any uncaught throw into a structured
 * JSON response carrying the requestId, logs the full error server-side, and
 * never leaks internals (stack / internal message) on a 5xx.
 */
export function errorHandler(): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const status = statusOf(err);
    logger.error({
      event: 'request_error',
      method: req.method,
      path: req.path,
      status,
      requestId: req.requestId,
      error: serializeError(err),
    });
    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : messageOf(err),
      requestId: req.requestId,
    });
  };
}
