import Database from 'better-sqlite3';
import { DB } from '../src/db';
import { initDatabase } from '../src/db';

export function createTestDb(): DB {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      expired_at INTEGER NOT NULL,
      sess TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      preview_text TEXT NOT NULL DEFAULT '',
      raw_text TEXT NOT NULL DEFAULT '',
      cleaned_text TEXT NOT NULL DEFAULT '',
      cleanup_model TEXT NOT NULL DEFAULT '',
      stt_model TEXT NOT NULL DEFAULT '',
      used_fallback INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'completed'
    );

    CREATE INDEX IF NOT EXISTS idx_transcripts_created_at ON transcripts(created_at);
    CREATE INDEX IF NOT EXISTS idx_transcripts_expires_at ON transcripts(expires_at);

    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_cleanup_model TEXT NOT NULL DEFAULT 'kimi',
      retention_days INTEGER NOT NULL DEFAULT 14
    );

    INSERT OR IGNORE INTO user_settings (id, default_cleanup_model, retention_days) VALUES (1, 'kimi', 14);
  `);

  return db;
}
