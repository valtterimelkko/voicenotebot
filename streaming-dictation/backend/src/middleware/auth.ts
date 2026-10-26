import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import { config } from '../config';

declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

export function sessionMiddleware() {
  return session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      maxAge: config.sessionTtlMs,
      sameSite: 'lax',
    },
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/** True when the request carries the configured service token (never when none is configured). */
function hasServiceToken(req: Request): boolean {
  const expected = config.serviceToken;
  if (!expected) return false;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length).trim());
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * The recording routes: the owner's password session, or the local service token (the Wheelhouse's large session
 * view sends the owner's microphone audio through them, 2026-10-26). Transcripts and settings stay session-only.
 */
export function requireAuthOrServiceToken(req: Request, res: Response, next: NextFunction) {
  if (req.session.userId || hasServiceToken(req)) return next();
  return res.status(401).json({ error: 'Authentication required' });
}
