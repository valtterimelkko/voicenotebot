# VoiceNote Bot

This repository now contains **two related voice-to-text systems**:

1. **Streaming Dictation** — the primary current product: a browser-based dictation PWA with session auth, transcript history, search, settings, retention, and AI cleanup.
2. **Legacy Telegram Bot** — the original queue-based Telegram voice-note bot, still kept working as a backup path.

## Start Here

- **Quick agent/developer guide:** [`AGENTS.md`](./AGENTS.md)
- **Streaming Dictation docs:** [`docs/STREAMING-DICTATION/README.md`](./docs/STREAMING-DICTATION/README.md)
- **Streaming Dictation operations:** [`docs/STREAMING-DICTATION/OPERATIONS.md`](./docs/STREAMING-DICTATION/OPERATIONS.md)
- **Streaming Dictation testing:** [`docs/STREAMING-DICTATION/TESTING.md`](./docs/STREAMING-DICTATION/TESTING.md)
- **Implementation plan:** [`STREAMING-DICTATION-PLAN.md`](./STREAMING-DICTATION-PLAN.md)
- **Architecture research:** [`RESEARCH-FINDINGS.md`](./RESEARCH-FINDINGS.md)

---

## Current Status

### Streaming Dictation

The new streaming dictation system is now a fully operational single-user web app/PWA.

Implemented today:
- password login + session cookie auth
- browser microphone capture via `MediaRecorder`
- recording lifecycle: `start` → `stream` → `finish`
- OpenAI STT with fallback handling
- cleanup via **Kimi** or **OpenAI `gpt-5-nano`**
- transcript history, search, copy, and settings
- SQLite persistence with retention cleanup
- warmup endpoint for lower-latency requests
- speculative transcription for faster finish-time results
- visibility-aware polling for history refresh
- `no-store` API caching to avoid stale history results
- systemd service + deploy script
- installable PWA shell

Recent checks run against the current repo state:
- `streaming-dictation/backend`: `npm test` ✅, `npm run typecheck` ✅
- `streaming-dictation/frontend`: `npm test` ✅, `npm run typecheck` ✅, `npm run build` ✅
- `streaming-dictation/backend`: `npm run lint` ✅

### Legacy Telegram Bot

The legacy Telegram bot remains in the repo and is still intended to work as a fallback transcription path.

It provides:
- FastAPI webhook intake
- Redis/RQ queueing
- worker-based transcription pipeline
- Telegram file download + response send-back
- local Whisper/OpenAI-style transcription flow
- Kimi cleanup
- Docker Compose-based deployment

---

## Architecture at a Glance

```text
Streaming Dictation (primary)
  Browser PWA
    -> /auth/* and /api/*
    -> Express + TypeScript backend
    -> OpenAI STT + Kimi/OpenAI cleanup
    -> SQLite transcript store
    -> systemd service behind Caddy

Legacy Telegram Bot (backup)
  Telegram
    -> FastAPI webhook
    -> Redis queue
    -> RQ workers
    -> Whisper primary / OpenAI fallback transcription + Kimi cleanup
    -> Docker Compose
```

---

## Repo Layout

```text
streaming-dictation/         Primary browser-based dictation app
  backend/                   Node + Express + SQLite backend
  frontend/                  React + Vite + TypeScript + PWA frontend
  scripts/                   Deploy helper(s)
  systemd/                   Service unit(s)

docs/STREAMING-DICTATION/    Streaming Dictation documentation

webhook/                     Legacy Telegram webhook service
worker/                      Legacy RQ worker pipeline
shared/                      Legacy shared Python utilities
tests/                       Legacy Python test suite

docker-compose.yml           Legacy Telegram bot orchestration
STREAMING-DICTATION-PLAN.md  Planning document for the new app
RESEARCH-FINDINGS.md         Architecture research and rationale
```

---

# Streaming Dictation

A browser-based PWA for phone-first and desktop dictation.

## Stack

| Component | Technology | Notes |
|---|---|---|
| Backend | Node.js + Express + TypeScript | Serves API and built frontend |
| Database | SQLite | WAL mode, local single-user persistence |
| Frontend | React + Vite + TypeScript + Tailwind | Responsive PWA |
| STT | OpenAI `gpt-4o-mini-transcribe` | Primary transcription model |
| Cleanup | Kimi or OpenAI `gpt-5-nano` | User-selectable cleanup |
| Auth | Session cookie | Single-user password login |
| Service | systemd | Production runtime |
| Proxy | Caddy | HTTPS / reverse proxy |

## Quick Start

### Backend setup

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm install
cp .env.example .env
```

Generate a password hash:

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 10).then(h => console.log(h))"
```

Add the generated hash to `.env` as `PASSWORD_HASH=...`, then build:

```bash
npm run build
```

### Frontend setup

```bash
cd /root/voicenotebot/streaming-dictation/frontend
npm install
npm run build
```

### Run via systemd

```bash
systemctl start streaming-dictation
systemctl status streaming-dictation
journalctl -u streaming-dictation -f
```

### Deploy updates

```bash
bash /root/voicenotebot/streaming-dictation/scripts/deploy.sh
```

## Common Operations

```bash
# Health
curl http://localhost:3100/health

# Restart service
systemctl restart streaming-dictation

# Backend tests
cd /root/voicenotebot/streaming-dictation/backend && npm test

# Frontend tests
cd /root/voicenotebot/streaming-dictation/frontend && npm test
```

## Documentation Map

- [`docs/STREAMING-DICTATION/README.md`](./docs/STREAMING-DICTATION/README.md) — docs index and product overview
- [`docs/STREAMING-DICTATION/ARCHITECTURE.md`](./docs/STREAMING-DICTATION/ARCHITECTURE.md) — backend/frontend/runtime behaviour
- [`docs/STREAMING-DICTATION/API.md`](./docs/STREAMING-DICTATION/API.md) — REST API
- [`docs/STREAMING-DICTATION/AUTH.md`](./docs/STREAMING-DICTATION/AUTH.md) — auth model
- [`docs/STREAMING-DICTATION/OPERATIONS.md`](./docs/STREAMING-DICTATION/OPERATIONS.md) — deployment and service management
- [`docs/STREAMING-DICTATION/TESTING.md`](./docs/STREAMING-DICTATION/TESTING.md) — checks and test coverage
- [`docs/STREAMING-DICTATION/TROUBLESHOOTING.md`](./docs/STREAMING-DICTATION/TROUBLESHOOTING.md) — common issues
- [`docs/STREAMING-DICTATION/BACKEND.md`](./docs/STREAMING-DICTATION/BACKEND.md) — backend-focused implementation notes
- [`docs/STREAMING-DICTATION/FRONTEND.md`](./docs/STREAMING-DICTATION/FRONTEND.md) — frontend-focused implementation notes

---

# Legacy Telegram Bot

A queue-based Telegram voice-to-text transcription bot using FastAPI, Redis/RQ, and worker processes.

## Legacy Architecture

```text
Telegram
  -> Caddy / HTTPS
  -> FastAPI webhook
  -> Redis queue
  -> RQ workers
  -> Whisper / OpenAI-style transcription path
  -> Kimi cleanup
  -> Telegram reply
```

## Core Services

| Service | Technology | Purpose | Location |
|---|---|---|---|
| Webhook | FastAPI + Uvicorn | Receives Telegram updates, enqueues jobs | `webhook/` |
| Worker | Python + RQ | Processes voice notes | `worker/` |
| Queue | Redis | Job queue management | Docker container |
| Shared | Python modules | Telegram client, Kimi client, logging | `shared/` |

## Legacy Quick Start

### Prerequisites

- Docker & Docker Compose
- Telegram bot token
- Kimi API key
- Whisper service available at `/root/whisper/`

### Configure

```bash
cd /root/voicenotebot
cp .env.example .env
```

Fill in at least:

```bash
TELEGRAM_BOT_TOKEN=your_token_here
KIMI_API_KEY=your_key_here
```

### Run

```bash
docker compose up -d
docker compose ps
curl http://localhost:9999/health
```

### Stop

```bash
docker compose down
```

### Logs

```bash
docker logs -f voicenotebot-webhook
docker logs -f voicenotebot-worker-1
docker logs -f voicenotebot-worker-2
```

## Legacy Notes

- The legacy bot uses **local Whisper as primary** and **OpenAI API as fallback**.
- Whisper access is guarded with a Redis-based distributed lock to reduce contention.
- The `TRANSCRIPTION_PROVIDER` env var controls explicit preference (`whisper` or `openai`).
- Some legacy Python test/docs surfaces may need refresh before being treated as authoritative current coverage.

---

## Security Notes

- Secrets live in `.env` files and should not be committed.
- Streaming Dictation depends on correct HTTPS/reverse-proxy handling for secure session cookies.
- Remote microphone access requires HTTPS or localhost.
- The legacy Redis queue is not intended to be exposed publicly.

## License

Private repository / personal use.
