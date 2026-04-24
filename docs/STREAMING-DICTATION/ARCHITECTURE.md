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
| Deployment | systemd behind Caddy |

## System Shape

```text
Browser PWA
  -> /auth/* and /api/*
  -> Express backend
      -> session auth
      -> recording lifecycle
      -> OpenAI STT
      -> Kimi / OpenAI cleanup
      -> SQLite transcripts + settings + sessions
      -> retention cleanup
  -> built frontend served by the same backend process
```

## Data Flow

```text
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
│  │     ├─ optional speculative start    │  │
│  │     ▼                                │  │
│  │  OpenAI STT (gpt-4o-mini-transcribe) │  │
│  │     │                                │  │
│  │     ├─ stream path (primary)         │  │
│  │     └─ batch path (fallback)         │  │
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

## Core Runtime Behaviour

## Recording lifecycle

1. `POST /api/recordings/start` creates an in-memory active recording.
2. `POST /api/recordings/:id/stream` appends raw audio chunks.
3. `POST /api/recordings/:id/finish` finalises the recording, runs STT, runs cleanup, stores the transcript, and returns it.

### Important implication

Active recordings are stored in an in-memory `Map`, not in SQLite. If the backend restarts during a recording, that recording is lost.

## Warmup behaviour

The backend exposes `POST /api/recordings/warmup`.

Purpose:
- pre-establish external API connections
- reduce first-request latency
- make the recording flow feel faster, especially after idle periods

This is a performance optimisation, not a required correctness step.

## Speculative transcription

For recordings that have already accumulated some audio, the backend can begin speculative transcription before `finish` is called.

Why it exists:
- reduces perceived wait time after the user stops recording
- overlaps some STT work with the tail end of recording time

It is best understood as a latency optimisation rather than a separate user-facing feature.

## Polling and freshness model

The history UI now uses visibility-aware refresh behaviour.

Current model:
- the frontend polls while the tab is visible
- polling pauses when the tab is hidden
- returning to the tab triggers a refresh
- `/api/*` responses are served with `Cache-Control: no-store`
- frontend fetches for history use no-store behaviour to reduce stale results

This is intentionally freshness-first. The app prefers live network reads over cached API data.

## Reverse proxy and session assumptions

The app is intended to run behind Caddy/HTTPS in production.

Important details:
- `trust proxy` is enabled on the Express app
- secure cookies depend on correct proxy forwarding and `NODE_ENV=production`
- remote microphone use requires HTTPS or localhost

If proxy configuration is wrong, authentication may appear broken even when the app itself is working.

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
| `status` | TEXT | `completed` |

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

- **Library**: express-session with SQLite-backed session persistence
- **Cookie**: httpOnly, secure in production, sameSite=lax
- **TTL**: 7 days
- **Auth model**: single shared password, not multi-user accounts

## Cleanup and retention

- Cleanup uses either Kimi or OpenAI, with the same broad transcript-cleaning intent.
- Retention cleanup runs on an interval and deletes transcripts past expiry.
- Retention affects stored transcript history, not active in-memory recordings.

## PWA note

The frontend is installable and precaches static assets, but the app should be thought of as an **installable networked PWA**, not as an offline dictation app.
