import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createTestApp } from './setup';
import { transcriptsRouter } from '../src/routes/transcripts';
import request from 'supertest';

function insertTranscript(db: ReturnType<typeof createTestDb>, id: string, raw: string, cleaned: string, createdAt?: string) {
  db.prepare(
    `INSERT INTO transcripts (id, created_at, expires_at, raw_text, cleaned_text, preview_text) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    createdAt || '2024-01-01T00:00:00Z',
    '2099-01-01T00:00:00Z',
    raw,
    cleaned,
    cleaned.slice(0, 200)
  );
}

describe('transcripts routes', () => {
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    app = createTestApp();
    app.use('/api/transcripts', transcriptsRouter(db));
  });

  it('GET / returns empty list initially', async () => {
    const res = await request(app).get('/api/transcripts');
    expect(res.status).toBe(200);
    expect(res.body.transcripts).toEqual([]);
  });

  it('GET / returns inserted transcripts', async () => {
    insertTranscript(db, 't1', 'hello', 'hello');
    const res = await request(app).get('/api/transcripts');
    expect(res.body.transcripts).toHaveLength(1);
    expect(res.body.transcripts[0].id).toBe('t1');
  });

  it('GET / returns transcripts ordered newest first', async () => {
    insertTranscript(db, 't1', 'first', 'first', '2024-01-01T00:00:00Z');
    insertTranscript(db, 't2', 'second', 'second', '2024-01-02T00:00:00Z');
    const res = await request(app).get('/api/transcripts');
    expect(res.body.transcripts[0].id).toBe('t2');
    expect(res.body.transcripts[1].id).toBe('t1');
  });

  it('GET /search?q= finds matching transcripts in cleaned_text', async () => {
    insertTranscript(db, 't1', 'hello world', 'hello world');
    insertTranscript(db, 't2', 'foo bar', 'foo bar');
    const res = await request(app).get('/api/transcripts/search?q=hello');
    expect(res.status).toBe(200);
    expect(res.body.transcripts).toHaveLength(1);
    expect(res.body.transcripts[0].id).toBe('t1');
  });

  it('GET /search?q= finds matching transcripts in raw_text', async () => {
    insertTranscript(db, 't1', 'unique raw text', 'something else');
    const res = await request(app).get('/api/transcripts/search?q=unique%20raw');
    expect(res.body.transcripts).toHaveLength(1);
    expect(res.body.transcripts[0].id).toBe('t1');
  });

  it('GET /search with no q returns empty array', async () => {
    insertTranscript(db, 't1', 'hello', 'hello');
    const res = await request(app).get('/api/transcripts/search');
    expect(res.status).toBe(200);
    expect(res.body.transcripts).toEqual([]);
  });

  it('GET /:id returns a single transcript', async () => {
    insertTranscript(db, 't1', 'hello', 'hello');
    const res = await request(app).get('/api/transcripts/t1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('t1');
    expect(res.body.raw_text).toBe('hello');
  });

  it('GET /:id returns 404 for missing transcript', async () => {
    const res = await request(app).get('/api/transcripts/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('DELETE /:id removes a transcript', async () => {
    insertTranscript(db, 't1', 'hello', 'hello');
    const res = await request(app).delete('/api/transcripts/t1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const check = await request(app).get('/api/transcripts/t1');
    expect(check.status).toBe(404);
  });

  it('DELETE /:id returns 404 for missing transcript', async () => {
    const res = await request(app).delete('/api/transcripts/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
