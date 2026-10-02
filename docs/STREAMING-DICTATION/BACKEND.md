# Backend — Streaming Dictation

Node.js + TypeScript + Express + SQLite backend for the Streaming Dictation system.

**Location:** `streaming-dictation/backend/`

## What This Layer Owns

The backend is responsible for:
- session authentication
- recording lifecycle endpoints
- STT orchestration
- cleanup model orchestration
- transcript persistence and search
- settings persistence
- transcript retention cleanup
- serving the built frontend bundle

For the broader system view, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Stack

| Technology | Purpose |
|---|---|
| Node.js + TypeScript | Runtime and type safety |
| Express 4 | HTTP server |
| better-sqlite3 | SQLite database |
| express-session | Cookie-based session auth |
| bcrypt | Password verification |
| OpenAI SDK | STT / cleanup API client |
| uuid | Recording IDs |
| Vitest + supertest | Tests |

## Development Commands

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm start
```

## Main Route Groups

| Route group | Purpose |
|---|---|
| `/auth/*` | Login, logout, session check |
| `/api/recordings/*` | Start, stream, finish, warmup |
| `/api/transcripts/*` | List, search, fetch, delete |
| `/api/settings` | Read/update cleanup model and retention |
| `/health` | Liveness check |

## Recording Runtime Model

The backend currently uses an in-memory active-recordings map.

That means:
- `/start` creates an entry
- `/stream` appends chunk buffers
- `/finish` consumes the buffered chunks, produces a transcript, and deletes the entry

### Operational consequence

If the process restarts during a recording, that in-progress recording is lost.

## STT Behaviour

Current model:
- OpenAI `whisper-large-v3-turbo (via OpenRouter; gpt-transcribe as last-resort fallback)` is the main STT model
- ⚠️ OpenAI retires it (with whisper-1 and gpt-4o-transcribe) on **2027-02-26**;
  the named replacements are `gpt-transcribe` (files/batch) and
  `gpt-live-transcribe` (streaming). Migration is a separate workstream —
  candidates incl. Groq whisper-turbo and local Parakeet are being evaluated,
  see session `pi:01a0fd50` in the Agent OS worklog.
- the backend attempts a primary path first
- if necessary, it retries via a fallback path
- longer recordings may benefit from speculative transcription started before `finish`

## Cleanup Behaviour

Current supported cleanup model:
- Google `gemma-4-26b-a4b-it` via **OpenRouter** (`OPENROUTER_API_KEY`), temperature 0.3
- chosen from the measured Benchmark 5 (97.4/100, zero ungrounded content words, 2.37 s p50)
- the served model identity is pinned in `src/services/models.ts` and reported
  truthfully by `GET /api/settings` (`effective_cleanup_model`, `cleanup_provider`)
- history: Kimi (removed after the Kimi key was deleted/leaked) → OpenAI
  `gpt-5-nano` (default reasoning dominated latency; its served snapshot is
  withdrawn 2026-12-11) → Gemma via OpenRouter

If cleanup fails, the backend keeps the raw transcript rather than failing the entire recording flow.

## Warmup / Latency Behaviour

The backend exposes a warmup endpoint to reduce initial latency when the app has been idle.

This is a performance feature, not a separate product workflow.

## Session / Proxy Notes

Important runtime details:
- Express is configured with `trust proxy`
- secure cookies depend on HTTPS and correct reverse-proxy forwarding
- production deployments should assume a reverse proxy such as Caddy in front of the app

## Frontend Serving

The backend serves the built frontend `dist/` directory directly. In production, one backend process handles both API traffic and static app delivery.

## Persistence

SQLite stores:
- transcripts
- user settings
- sessions

Retention cleanup periodically deletes expired transcript rows.

## Current Verification Notes

Current checked status:
- backend tests pass
- backend typecheck passes
- backend lint passes
