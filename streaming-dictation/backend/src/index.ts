import { config } from './config';
import { initDatabase, DB } from './db';
import { createApp } from './app';
import { scheduleRetention } from './services/retention';
import { createShutdown } from './services/shutdown';

const db: DB = initDatabase(config.databasePath);
const app = createApp(db, { serveStatic: true });

if (require.main === module) {
  const retentionTimer = scheduleRetention(db, config.retentionDays);
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
