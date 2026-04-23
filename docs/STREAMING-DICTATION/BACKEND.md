# Backend — Streaming Dictation

Node.js + TypeScript + Express + SQLite backend for the streaming dictation system.

**Location:** `streaming-dictation/backend/`

---

## Stack

| Technology | Purpose |
|---|---|
| Node.js + TypeScript | Runtime and type safety |
| Express 4 | HTTP server |
| better-sqlite3 | SQLite database (synchronous API) |
| express-session | Cookie-based session auth |
| bcrypt | Password hashing |
| OpenAI SDK | STT and cleanup API client |
| uuid | Recording session IDs |
| Vitest + supertest | Unit and integration tests |

---

## Dev Commands

```bash
cd streaming-dictation/backend

# Install dependencies
npm install

# Start dev server with hot reload
npm run dev

# Build TypeScript to dist/
npm run build

# Run production build
npm start

# Type check only
npm run typecheck

# Run tests
npm test
```

---

## Project Structure

```
src/
  index.ts           — Express app setup, route mounting, static asset serving
  config.ts          — env var loading, defaults
  db.ts              — SQLite schema init, DB type
  middleware/
    auth.ts          — sessionMiddleware(), requireAuth middleware
  routes/
    auth.ts          — POST /auth/login, POST /auth/logout, GET /auth/session
    recordings.ts    — POST /api/recordings/start, /:id/stream, /:id/finish
    transcripts.ts   — GET /api/transcripts, /search, /:id, DELETE /:id
    settings.ts      — GET/PUT /api/settings
    health.ts        — GET /health
  services/
    auth.ts          — verifyPassword() using bcrypt
    stt.ts           — transcribeWithFallback() — OpenAI primary + batch fallback
    cleanup.ts       — cleanupTranscript() — Kimi or gpt-5-nano
    retention.ts     — scheduleRetention() — interval-based expired record cleanup
tests/
  setup.ts           — createTestDb(), createTestApp() test utilities
  auth.test.ts
  api.test.ts
  transcripts.test.ts
  settings.test.ts
  cleanup.test.ts
  stt.test.ts
  retention.test.ts
```

---

## Environment Variables

Create `streaming-dictation/backend/.env` (copy from `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3100` | HTTP server port |
| `SESSION_SECRET` | **Yes** | `dev-secret-change-in-prod` | Express session signing secret |
| `PASSWORD_HASH` | **Yes** | `` (empty = no auth) | bcrypt hash of the login password |
| `OPENAI_API_KEY` | **Yes** | — | OpenAI API key for STT + cleanup |
| `KIMI_API_KEY` | **Yes** | — | Kimi (Moonshot) API key for cleanup |
| `DEFAULT_CLEANUP_MODEL` | No | `kimi` | Default cleanup model: `kimi` or `gpt-5-nano` |
| `RETENTION_DAYS` | No | `14` | How many days to keep transcripts |
| `DATABASE_PATH` | No | `backend/data/transcripts.db` | Path to SQLite file |
| `NODE_ENV` | No | `development` | Set to `production` for production |

### Generate a password hash

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('yourpassword', 12).then(h => console.log(h))"
```

Then set `PASSWORD_HASH=<output>` in `.env`.

---

## Database Schema

Two tables managed by `db.ts`:

### `transcripts`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID from recording session |
| `created_at` | TEXT | ISO 8601 UTC |
| `expires_at` | TEXT | ISO 8601 UTC (created_at + retention_days) |
| `preview_text` | TEXT | First 200 chars of cleaned_text |
| `raw_text` | TEXT | Raw STT output |
| `cleaned_text` | TEXT | Cleanup model output |
| `cleanup_model` | TEXT | `kimi` or `gpt-5-nano` |
| `stt_model` | TEXT | `gpt-4o-mini-transcribe` |
| `used_fallback` | INTEGER | `0` = primary, `1` = batch fallback used |
| `duration_ms` | INTEGER | Recording duration in ms |
| `status` | TEXT | `completed` or `failed` |

### `user_settings`

Single row (id=1):

| Column | Type | Default |
|---|---|---|
| `id` | INTEGER PK | 1 |
| `default_cleanup_model` | TEXT | `kimi` |
| `retention_days` | INTEGER | 14 |

---

## STT Flow

Implemented in `services/stt.ts`:

1. **Primary:** Assemble all chunks into a single `Buffer`, submit to `openai.audio.transcriptions.create` with model `gpt-4o-mini-transcribe`
2. **Fallback:** If primary throws, retry with the same model and a different request strategy (batch rescue path)
3. Returns `{ text, model, usedFallback: boolean }`

---

## Cleanup Flow

Implemented in `services/cleanup.ts`:

### Kimi

- Endpoint: `https://api.moonshot.cn/v1/chat/completions`
- Model: `moonshot-v1-8k`
- Auth: `Authorization: Bearer <KIMI_API_KEY>`
- Request: `Content-Type: application/json`
- Prompt: Clean up voice transcript, preserve meaning, fix punctuation/capitalisation

### OpenAI gpt-5-nano

- Endpoint: OpenAI chat completions via SDK
- Model: `gpt-5-nano`
- Same cleanup prompt intent

Both return `{ cleanedText: string }`.

---

## Retention Job

`services/retention.ts` exports `scheduleRetention(db, retentionDays)`:
- Runs at startup and then every 6 hours
- `DELETE FROM transcripts WHERE expires_at < datetime('now')`
- Returns the interval handle (cleared on SIGTERM)

---

## Recording Session Handling

`routes/recordings.ts` keeps an in-memory `Map<string, ActiveRecording>`:
- `POST /api/recordings/start` — creates entry with empty chunks array
- `POST /api/recordings/:id/stream` — appends `Buffer` chunk
- `POST /api/recordings/:id/finish` — assembles blob, runs STT, cleanup, persists transcript, deletes from Map

Sessions are ephemeral (in-memory). A backend restart loses in-progress recordings. This is acceptable for v1.

---

## Frontend Asset Serving

`src/index.ts` serves the built frontend:

```ts
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist')
app.use(express.static(frontendDist))
app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')))
```

This means one process (port 3100) serves both the API and the SPA.

---

## API Summary

See [API.md](./API.md) for full request/response shapes.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/login` | No | Login with password |
| POST | `/auth/logout` | No | Destroy session |
| GET | `/auth/session` | No | Check session |
| POST | `/api/recordings/start` | Yes | Start recording session |
| POST | `/api/recordings/:id/stream` | Yes | Upload audio chunk |
| POST | `/api/recordings/:id/finish` | Yes | Finalize, returns Transcript |
| GET | `/api/transcripts` | Yes | List all (newest first) |
| GET | `/api/transcripts/search?q=` | Yes | Text search |
| GET | `/api/transcripts/:id` | Yes | Single transcript |
| DELETE | `/api/transcripts/:id` | Yes | Delete transcript |
| GET | `/api/settings` | Yes | Get settings |
| PUT | `/api/settings` | Yes | Update settings |
| GET | `/health` | No | Health check |

---

## Testing

```bash
npm test
```

Tests use an in-memory SQLite database (`:memory:`) and `supertest` for route integration tests. OpenAI and Kimi clients are mocked.

See [TESTING.md](./TESTING.md) for full test strategy.
