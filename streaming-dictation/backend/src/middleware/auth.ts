import { Router, Request, Response, NextFunction } from 'express';
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
