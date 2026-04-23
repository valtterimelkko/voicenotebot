# Testing

## Framework

- **Vitest** — test runner and assertions
- **supertest** — HTTP integration testing
- **better-sqlite3** — in-memory SQLite for test isolation

## Commands

```bash
cd /root/voicenotebot/streaming-dictation/backend

# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Type check without emitting
npm run typecheck

# Lint
npm run lint
```

## Test Files

| File | Category | Description |
|------|----------|-------------|
| `tests/setup.ts` | Utility | `createTestDb()` helper — creates an in-memory SQLite with the full schema |
| `tests/auth.test.ts` | Unit | Password verification and auth route tests |
| `tests/api.test.ts` | Integration | Full API integration tests (currently stubs) |
| `tests/cleanup.test.ts` | Unit | Kimi and OpenAI cleanup service tests |
| `tests/stt.test.ts` | Unit | OpenAI STT transcription tests |
| `tests/retention.test.ts` | Unit | Retention cleanup logic |
| `tests/settings.test.ts` | Unit | Settings CRUD |
| `tests/transcripts.test.ts` | Unit | Transcript CRUD and search |

## Test Database

Tests use `createTestDb()` from `tests/setup.ts` which creates an in-memory SQLite database with the same schema as production. This ensures:

- No file I/O during tests
- Full isolation between test runs
- Fast execution
- Schema compatibility with production

## Writing Tests

Tests follow the Vitest pattern:

```typescript
import { describe, it, expect } from 'vitest';
import { createTestDb } from './setup';

describe('my feature', () => {
  it('should work', () => {
    const db = createTestDb();
    // test against db
  });
});
```

For route tests, create the Express app with a test database and use supertest:

```typescript
import request from 'supertest';
import { app } from '../src/index';
```
