import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { createTestDb, createApp, createTestApp } from './setup';
import { requestId } from '../src/middleware/requestId';
import { errorHandler } from '../src/middleware/errorHandler';
import request from 'supertest';

/**
 * Capture JSON log lines emitted to stdout/stderr by the logger/requestLogger
 * so we can assert on structured output without depending on journald.
 */
function captureLog(): { lines: Record<string, unknown>[]; restore: () => void } {
  const lines: Record<string, unknown>[] = [];
  const push = (...args: unknown[]) => {
    for (const a of args) {
      try { lines.push(JSON.parse(String(a)) as Record<string, unknown>); } catch { /* non-JSON line */ }
    }
  };
  const stdout = vi.spyOn(console, 'log').mockImplementation(push);
  const stderr = vi.spyOn(console, 'error').mockImplementation(push);
  return { lines, restore: () => { stdout.mockRestore(); stderr.mockRestore(); } };
}

describe('DB-aware /health', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    app = createApp(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed by a test */ }
  });

  it('returns 200 ok when the database connection is open', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns 503 degraded when the database connection is closed', async () => {
    db.close();
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
  });
});

describe('requestId middleware', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    app = createApp(db);
  });
  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  it('attaches an X-Request-Id header to every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(typeof res.headers['x-request-id']).toBe('string');
  });

  it('propagates an inbound X-Request-Id header', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'abc-123-fixed');
    expect(res.headers['x-request-id']).toBe('abc-123-fixed');
  });
});

describe('requestLogger middleware', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    app = createApp(db);
  });
  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  it('emits one structured JSON request line per request', async () => {
    const cap = captureLog();
    try {
      await request(app).get('/health');
      const reqLine = cap.lines.find((l) => l.event === 'request');
      expect(reqLine).toBeDefined();
      expect(reqLine).toMatchObject({ method: 'GET', path: '/health', status: 200 });
      expect(reqLine!.requestId).toBeTruthy();
      expect(typeof reqLine!.durationMs).toBe('number');
    } finally {
      cap.restore();
    }
  });
});

describe('errorHandler middleware', () => {
  function boomApp() {
    const app = createTestApp();
    app.use(requestId());
    app.get('/boom', () => { throw new Error('kaboom'); });
    app.get('/bad', () => {
      const e = new Error('bad input') as Error & { status?: number };
      e.status = 400;
      throw e;
    });
    app.use(errorHandler());
    return app;
  }

  it('turns an uncaught 5xx error into a structured response without leaking internals', async () => {
    const cap = captureLog();
    try {
      const res = await request(boomApp()).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      expect(res.body.requestId).toBeTruthy();
      expect(res.headers['x-request-id']).toBe(res.body.requestId);
      // no stack / internal message leak
      expect(JSON.stringify(res.body)).not.toContain('kaboom');
      expect(cap.lines.some((l) => l.event === 'request_error' && l.status === 500)).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it('surfaces the message for thrown <500 errors', async () => {
    const res = await request(boomApp()).get('/bad');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad input');
  });
});
