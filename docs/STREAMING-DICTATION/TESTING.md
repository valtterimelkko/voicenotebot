# Testing

## Current Verification Snapshot

The current repository state has been verified with the following Streaming Dictation checks:

### Backend

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm test
npm run typecheck
```

Result:
- **79 tests passed**
- typecheck passed

### Frontend

```bash
cd /root/voicenotebot/streaming-dictation/frontend
npm test
npm run typecheck
npm run build
```

Result:
- **29 tests passed**
- typecheck passed
- production build passed

### Current tooling caveat

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm run lint
```

This currently fails because ESLint v9 expects a flat `eslint.config.*` file.

## Frameworks

### Backend
- **Vitest** — test runner and assertions
- **supertest** — HTTP integration testing
- **better-sqlite3** — in-memory SQLite for isolated DB-backed tests

### Frontend
- **Vitest** — test runner
- **Testing Library** — component/page rendering and interactions
- **jsdom** — browser-like test environment

## Commands

### Backend

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm test
npm run test:watch
npm run typecheck
npm run lint
```

### Frontend

```bash
cd /root/voicenotebot/streaming-dictation/frontend
npm test
npm run test:watch
npm run typecheck
npm run build
```

## Backend Test Coverage

Backend tests currently cover:
- authentication routes and password verification
- session checks and logout
- recordings API start/stream/finish flow
- transcript list/search/get/delete
- settings read/update persistence
- STT fallback behaviour
- cleanup service behaviour
- retention cleanup behaviour
- connection warmup support
- end-to-end authenticated recording flow
- graceful handling of STT and cleanup failures

### Backend test files

| File | Category | Notes |
|------|----------|-------|
| `tests/setup.ts` | Utility | In-memory DB helpers |
| `tests/auth.test.ts` | Route/unit | Login, logout, session |
| `tests/api.test.ts` | Integration | Auth-protected route behaviour |
| `tests/transcripts.test.ts` | Route/unit | Transcript CRUD + search |
| `tests/settings.test.ts` | Route/unit | Settings CRUD |
| `tests/stt.test.ts` | Unit | STT path + fallback logic |
| `tests/cleanup.test.ts` | Unit | Kimi/OpenAI cleanup logic |
| `tests/retention.test.ts` | Unit | Expiry deletion |
| `tests/connectionPool.test.ts` | Unit | Warmup/connection helpers |
| `tests/e2e.test.ts` | Integration | Full login → recording → transcript → search flow |

## Frontend Test Coverage

Frontend tests currently cover:
- login page rendering and error handling
- record button state rendering
- copy button feedback
- history page loading and transcript rendering
- search page behaviour
- settings page behaviour
- visibility polling behaviour

### Frontend test files

| File | Category | Notes |
|------|----------|-------|
| `src/tests/setup.ts` | Utility | Test environment setup |
| `src/tests/LoginPage.test.tsx` | Page | Login form behaviour |
| `src/tests/components.test.tsx` | Component | RecordButton, CopyButton, TranscriptCard-related behaviour |
| `src/tests/pages.test.tsx` | Page/hook | History, Search, Settings, visibility polling |

## Test Database Strategy

Backend tests use an in-memory SQLite database with the production schema so they can:
- run fast
- avoid file I/O
- stay isolated from real transcript data
- exercise real SQL-backed route behaviour

## Known Gaps

The current test suite is good for unit/integration coverage, but it does **not** yet provide:
- real browser microphone capture tests
- real `MediaRecorder` browser E2E coverage
- service worker / PWA runtime tests
- systemd deployment smoke tests
- end-to-end HTTPS/reverse-proxy auth tests

## Legacy Test Note

The repo also contains a legacy Python test suite under `/root/voicenotebot/tests`, but that coverage should be treated cautiously until refreshed against the current legacy implementation and current environment.
