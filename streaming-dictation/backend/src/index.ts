import { config } from './config';
import { initDatabase, DB } from './db';
import { createApp } from './app';
import { scheduleRetention } from './services/retention';
import { createShutdown } from './services/shutdown';
import { pruneFailedAudio } from './services/failed-audio';

const db: DB = initDatabase(config.databasePath);
const app = createApp(db, { serveStatic: true });

if (require.main === module) {
  const retentionTimer = scheduleRetention(db, config.retentionDays);
  // Kept failed audio lives a day: prune at boot and hourly.
  if (config.failedAudioDir !== '') {
    pruneFailedAudio(config.failedAudioDir);
    setInterval(() => pruneFailedAudio(config.failedAudioDir), 60 * 60 * 1000).unref();
  }
  app.listen(config.port, () => {
    console.log(`streaming-dictation backend listening on port ${config.port}`);
  });
  // Clean exit on any termination signal so systemd (Restart=always) revives us.
  const shutdown = createShutdown(db, retentionTimer);
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { app };
export { db };
