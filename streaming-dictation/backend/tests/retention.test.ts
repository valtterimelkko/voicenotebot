import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './setup';
import { runRetentionCleanup } from '../src/services/retention';

describe('runRetentionCleanup', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it('deletes transcripts with expires_at in the past', () => {
    db.prepare(
      `INSERT INTO transcripts (id, expires_at, raw_text, cleaned_text, preview_text) VALUES (?, datetime('now', '-1 day'), ?, ?, ?)`
    ).run('expired1', 'old text', 'old text', 'old text');

    const deleted = runRetentionCleanup(db, 14);
    expect(deleted).toBe(1);

    const remaining = db.prepare('SELECT * FROM transcripts').all();
    expect(remaining).toHaveLength(0);
  });

  it('keeps transcripts with expires_at in the future', () => {
    db.prepare(
      `INSERT INTO transcripts (id, expires_at, raw_text, cleaned_text, preview_text) VALUES (?, datetime('now', '+7 days'), ?, ?, ?)`
    ).run('active1', 'active text', 'active text', 'active text');

    const deleted = runRetentionCleanup(db, 14);
    expect(deleted).toBe(0);

    const remaining = db.prepare('SELECT * FROM transcripts').all();
    expect(remaining).toHaveLength(1);
  });

  it('deletes only expired transcripts, keeps active ones', () => {
    db.prepare(
      `INSERT INTO transcripts (id, expires_at, raw_text, cleaned_text, preview_text) VALUES (?, datetime('now', '-1 day'), ?, ?, ?)`
    ).run('expired1', 'old', 'old', 'old');
    db.prepare(
      `INSERT INTO transcripts (id, expires_at, raw_text, cleaned_text, preview_text) VALUES (?, datetime('now', '+7 days'), ?, ?, ?)`
    ).run('active1', 'new', 'new', 'new');

    const deleted = runRetentionCleanup(db, 14);
    expect(deleted).toBe(1);

    const remaining = db.prepare("SELECT id FROM transcripts WHERE expires_at > datetime('now')").all() as { id: string }[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('active1');
  });

  it('returns 0 when no transcripts exist', () => {
    const deleted = runRetentionCleanup(db, 14);
    expect(deleted).toBe(0);
  });

  it('deletes multiple expired transcripts', () => {
    db.prepare(
      `INSERT INTO transcripts (id, expires_at, raw_text, cleaned_text, preview_text) VALUES (?, datetime('now', '-1 day'), ?, ?, ?)`
    ).run('exp1', 'a', 'a', 'a');
    db.prepare(
      `INSERT INTO transcripts (id, expires_at, raw_text, cleaned_text, preview_text) VALUES (?, datetime('now', '-2 days'), ?, ?, ?)`
    ).run('exp2', 'b', 'b', 'b');
    db.prepare(
      `INSERT INTO transcripts (id, expires_at, raw_text, cleaned_text, preview_text) VALUES (?, datetime('now', '+1 day'), ?, ?, ?)`
    ).run('act1', 'c', 'c', 'c');

    const deleted = runRetentionCleanup(db, 14);
    expect(deleted).toBe(2);

    const remaining = db.prepare('SELECT * FROM transcripts').all();
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as any).id).toBe('act1');
  });
});
