import express from 'express';
import { config } from './config';
import { initDatabase } from './db';
import { authRouter } from './routes/auth';
import { transcriptsRouter } from './routes/transcripts';
import { settingsRouter } from './routes/settings';
import { recordingsRouter } from './routes/recordings';
import { healthRouter } from './routes/health';
import path from 'path';

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

const db = initDatabase(config.databasePath);

app.locals.db = db;

app.use('/auth', authRouter(db));
app.use('/api/recordings', recordingsRouter(db));
app.use('/api/transcripts', transcriptsRouter(db));
app.use('/api/settings', settingsRouter(db));
app.use('/', healthRouter());

const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`streaming-dictation backend listening on port ${config.port}`);
  });
}

export { app };
