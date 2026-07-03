import { logger } from './logger';

/** Minimal dependency needed from the database, inverted for testability. */
export interface Shutdownable {
  close(): void;
}

/**
 * Build a signal handler that performs a clean shutdown.
 *
 * The bug this fixes (2026-07-03 outage): the old SIGTERM handler called
 * db.close() but never exited, leaving Express alive over a dead DB. This
 * clears the retention timer, closes the DB, and THEN exits the process so
 * systemd (with Restart=always) can revive it.
 */
export function createShutdown(db: Shutdownable, retentionTimer: NodeJS.Timeout) {
  return (signal: string): void => {
    logger.info({ event: 'shutdown', signal });
    clearInterval(retentionTimer);
    try {
      db.close();
    } catch (err) {
      logger.warn({
        event: 'db_close_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Mandatory: without exiting, the process keeps serving over a closed DB.
    process.exit(0);
  };
}
