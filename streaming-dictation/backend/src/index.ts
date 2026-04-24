import express from 'express';
import { config } from './config';
import { initDatabase, DB } from './db';
import { authRouter } from './routes/auth';
import { transcriptsRouter } from './routes/transcripts';
import { settingsRouter } from './routes/settings';
import { recordingsRouter } from './routes/recordings';
import { healthRouter } from './routes/health';
import { sessionMiddleware, requireAuth } from './middleware/auth';
import { scheduleRetention } from './services/retention';
import path from 'path';

const app = express();

app.set('trust proxy', 1);

app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));
app.use(sessionMiddleware());

const db: DB = initDatabase(config.databasePath);

app.locals.db = db;

app.use('/auth', authRouter(db));
app.use('/api/recordings', requireAuth, recordingsRouter(db));
app.use('/api/transcripts', requireAuth, transcriptsRouter(db));
app.use('/api/settings', requireAuth, settingsRouter(db));
app.use('/', healthRouter());

const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res, next) => {
  if (_req.accepts('html') || _req.path.includes('.')) {
    res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
      if (err) next(err);
    });
  } else {
    next();
  }
});

if (require.main === module) {
  const retentionTimer = scheduleRetention(db, config.retentionDays);
  app.listen(config.port, () => {
    console.log(`streaming-dictation backend listening on port ${config.port}`);
  });
  process.on('SIGTERM', () => {
    clearInterval(retentionTimer);
    db.close();
  });
}

export { app };
export { db };
