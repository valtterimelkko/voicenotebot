# Architecture

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + TypeScript + Express 4 |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Frontend | React + Vite + TypeScript + Tailwind |
| PWA | vite-plugin-pwa |
| STT | OpenAI `gpt-4o-mini-transcribe` |
| Cleanup | Kimi (`kimi-for-coding`) or OpenAI (`gpt-5-nano`) |
| Test | Vitest + supertest |

## Data Flow

```
Browser Microphone
       │
       ▼
┌─────────────────────────────────────────────┐
│  Frontend (React PWA)                       │
│  1. POST /api/recordings/start              │
│  2. POST /api/recordings/:id/stream (x N)   │
│  3. POST /api/recordings/:id/finish         │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Express Backend (port 3100)                │
│                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Session │  │ Recording│  │ Transcript│ │
│  │ Auth    │  │ Router   │  │ Router    │ │
│  └─────────┘  └────┬─────┘  └───────────┘ │
│                    │                        │
│                    ▼                        │
│  ┌──────────────────────────────────────┐  │
│  │           Processing Pipeline        │  │
│  │                                      │  │
│  │  Audio chunks                        │  │
│  │     │                                │  │
│  │     ▼                                │  │
│  │  OpenAI STT (gpt-4o-mini-transcribe) │  │
│  │     │                                │  │
│  │     ├─ streamTranscribe (primary)    │  │
│  │     └─ batchTranscribe (fallback)    │  │
│  │     │                                │  │
│  │     ▼                                │  │
│  │  LLM Cleanup                         │  │
│  │     ├─ Kimi (kimi-for-coding)        │  │
│  │     └─ OpenAI (gpt-5-nano)           │  │
│  │     │                                │  │
│  │     ▼                                │  │
│  │  SQLite (transcripts table)          │  │
│  └──────────────────────────────────────┘  │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │  Retention Cleanup (every 1 hour)    │  │
│  │  Deletes transcripts past expiry     │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Database Schema

### `transcripts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `created_at` | TEXT | ISO timestamp, auto-set |
| `expires_at` | TEXT | ISO timestamp, calculated from retention_days |
| `preview_text` | TEXT | First 200 chars of cleaned text |
| `raw_text` | TEXT | Raw STT output |
| `cleaned_text` | TEXT | LLM-cleaned output |
| `cleanup_model` | TEXT | `kimi` or `gpt-5-nano` |
| `stt_model` | TEXT | `gpt-4o-mini-transcribe` |
| `used_fallback` | INTEGER | 1 if batch fallback was used |
| `duration_ms` | INTEGER | Recording duration in milliseconds |
| `status` | TEXT | Always `completed` |

### `user_settings`

Single-row table (`id = 1`):

| Column | Type | Default |
|--------|------|---------|
| `id` | INTEGER PK | 1 |
| `default_cleanup_model` | TEXT | `kimi` |
| `retention_days` | INTEGER | 14 |

### `sessions`

Used by express-session store:

| Column | Type |
|--------|------|
| `sid` | TEXT PK |
| `expired_at` | INTEGER |
| `sess` | TEXT |

## Session Management

- **Library**: express-session with SQLite store
- **Cookie**: httpOnly, secure in production, sameSite=lax
- **TTL**: 7 days (`sessionTtlMs` in config)
- **Auth**: bcrypt password comparison, sets `req.session.userId = 'user'`

## Recording Pipeline

1. **Start**: Client calls `POST /api/recordings/start`, receives a UUID. Server creates an in-memory `ActiveRecording` with an empty chunk array.
2. **Stream**: Client sends audio chunks as raw binary (`application/octet-stream`) to `POST /api/recordings/:id/stream`. Each chunk is appended to the in-memory array.
3. **Finish**: Client calls `POST /api/recordings/:id/finish`. Server:
   - Concatenates all chunks into a single buffer
   - Calls `transcribeWithFallback()` (streaming attempt, then batch fallback)
   - Reads user settings for cleanup model and retention days
   - Calls `cleanupTranscript()` with the raw text
   - Computes preview (first 200 chars) and expiry date
   - Inserts into `transcripts` table
   - Returns the full transcript row

## STT Service

Primary: `streamTranscribe()` sends WebM audio blob to OpenAI.
Fallback: `batchTranscribe()` sends the concatenated buffer as a File object.
Both use model `gpt-4o-mini-transcribe` with `response_format: 'text'`.

## Cleanup Service

Two backends with identical system prompt and temperature (0.3):

- **Kimi**: Direct HTTP to `https://api.kimi.com/coding/v1/chat/completions`, model `kimi-for-coding`, max_tokens 60000, 300s timeout
- **OpenAI**: Via OpenAI SDK, model `gpt-5-nano`

System prompt instructs: fix spelling/grammar, convert to British spellings, remove fillers, preserve speaker's voice and language.

## Retention

- Runs every 60 minutes via `setInterval`
- Deletes all transcripts where `expires_at < now`
- Logs count of deleted rows if any
- Cleanup interval cleared on `SIGTERM`
