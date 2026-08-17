# Agent Guide for VoiceNote Bot

> AGENTS.md and CLAUDE.md are byte-identical — same file for different harnesses. Edit AGENTS.md and copy to CLAUDE.md on every change.

Read this first, then follow the linked docs.

## Start Here

- **Public repo overview / project story:** [`README.md`](./README.md)
- **Maintainer runbook / original operational notes:** [`docs/MAINTAINER-RUNBOOK.md`](./docs/MAINTAINER-RUNBOOK.md)
- **Streaming Dictation docs index:** [`docs/STREAMING-DICTATION/README.md`](./docs/STREAMING-DICTATION/README.md)
- **Streaming Dictation operations:** [`docs/STREAMING-DICTATION/OPERATIONS.md`](./docs/STREAMING-DICTATION/OPERATIONS.md)
- **Streaming Dictation testing:** [`docs/STREAMING-DICTATION/TESTING.md`](./docs/STREAMING-DICTATION/TESTING.md)
- **Legacy Telegram bot runbook:** [`docs/MAINTAINER-RUNBOOK.md`](./docs/MAINTAINER-RUNBOOK.md)
- **Streaming Dictation implementation plan/history:** [`STREAMING-DICTATION-PLAN.md`](./STREAMING-DICTATION-PLAN.md), [`RESEARCH-FINDINGS.md`](./RESEARCH-FINDINGS.md)

## Repo Shape

This repo contains **two related but separate systems**:

1. **Streaming Dictation** — the current browser-based PWA in `streaming-dictation/`
2. **Legacy Telegram Bot** — the Docker Compose + FastAPI + RQ pipeline in `webhook/`, `worker/`, `shared/`, `tests/`

Prefer treating **Streaming Dictation as the primary active product** unless the task is explicitly about the legacy Telegram bot.

## Working Rules

- Keep changes scoped to the subsystem you are touching.
- Do **not** refactor the legacy bot while working on Streaming Dictation unless the task requires it.
- Update docs whenever runtime behaviour, deployment steps, or test commands change.
- Prefer small, verified changes over broad cleanup.


## Donor for video-recorder

This repo is the donor for `video-recorder`'s transcription path:

- `shared/openai_transcription_client.py` — shared OpenAI transcription client used by the legacy worker
- `worker/tasks.py` — fallback/queue transcription task
- `streaming-dictation/backend/src/services/stt.ts` — streaming STT service (primary donor pattern for `video-recorder`'s Whisper/OpenAI fallback)

`video-recorder` borrows `WHISPER_URL=http://whisper:9000/asr`, concurrency 1, no-cloud defaults from this repo's `.env`.

## Verification

### Streaming Dictation backend

```bash
cd streaming-dictation/backend
npm test
npm run typecheck
npm run lint
```

### Streaming Dictation frontend

```bash
cd streaming-dictation/frontend
npm test
npm run typecheck
npm run build
```

### Legacy Telegram bot

See the root README for Docker Compose commands and legacy test notes. Verify the current environment before claiming Python test coverage.

## Important Notes

- Streaming Dictation runs as a **systemd service** and is expected behind **Caddy/HTTPS** in production.
- Session/auth behaviour for Streaming Dictation depends on correct reverse-proxy handling.
- The frontend has an installable PWA shell, but it is **not an offline-first app**.
- Active in-progress recordings are currently held **in memory** on the backend.

## Before Finishing

- Review `git status --short`
- Review `git diff --stat`
- Mention which subsystem you changed
- Mention which checks you actually ran
