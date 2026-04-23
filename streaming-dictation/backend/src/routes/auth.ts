import { Router, Request, Response } from 'express';
import { DB } from '../db';
import { verifyPassword } from '../services/auth';

export function authRouter(_db: DB): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    const { password } = req.body;
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required' });
    }
    const valid = await verifyPassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.userId = 'user';
    res.json({ ok: true });
  });

  router.post('/logout', (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  router.get('/session', (req: Request, res: Response) => {
    if (req.session.userId) {
      res.json({ authenticated: true });
    } else {
      res.json({ authenticated: false });
    }
  });

  return router;
}
