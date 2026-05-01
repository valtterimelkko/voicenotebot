import { DB } from '../db';

export function runRetentionCleanup(db: DB, retentionDays: number): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const result = db.prepare(
    "DELETE FROM transcripts WHERE expires_at < datetime('now')"
  ).run();
  return result.changes;
}

export function scheduleRetention(db: DB, retentionDays: number): NodeJS.Timeout {
  return setInterval(() => {
    const deleted = runRetentionCleanup(db, retentionDays);
    if (deleted > 0) {
      console.log(`retention cleanup: removed ${deleted} expired transcripts`);
    }
  }, 7 * 24 * 60 * 60 * 1000);
}
