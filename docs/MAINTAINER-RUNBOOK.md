# Maintainer Runbook

This document preserves the original maintainer-facing operational guidance that used to live in the root README.

Use the public [`../README.md`](../README.md) for project overview, story, and adoption. Use this file when operating the original self-hosted setup.

## Repo shape

This repo contains two related but separate systems:

1. **Streaming Dictation** — the current browser-based PWA in `streaming-dictation/`
2. **Legacy Telegram Bot** — the Docker Compose + FastAPI + RQ pipeline in `webhook/`, `worker/`, `shared/`, `tests/`

Prefer treating **Streaming Dictation as the primary active product** unless the task is explicitly about the legacy Telegram bot.

## Maintainer quick commands

### Streaming Dictation backend

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm test
npm run typecheck
npm run lint
```

### Streaming Dictation frontend

```bash
cd /root/voicenotebot/streaming-dictation/frontend
npm test
npm run typecheck
npm run build
```

### Service management

```bash
systemctl start streaming-dictation
systemctl status streaming-dictation
journalctl -u streaming-dictation -f
```

Deploy updates:

```bash
bash /root/voicenotebot/streaming-dictation/scripts/deploy.sh
```

Health check:

```bash
curl http://localhost:3100/health
```

### Legacy Telegram bot

Configure:

```bash
cd /root/voicenotebot
cp .env.example .env
```

Run:

```bash
docker compose up -d
docker compose ps
curl http://localhost:9999/health
```

Logs:

```bash
docker logs -f voicenotebot-webhook
docker logs -f voicenotebot-worker-1
docker logs -f voicenotebot-worker-2
```

## Original operational notes

- Streaming Dictation was expected to run as a systemd service behind Caddy/HTTPS.
- Secure session-cookie behaviour depends on correct reverse-proxy handling.
- The frontend is an installable PWA shell, but it is not an offline-first app.
- Active in-progress recordings are currently held in memory on the backend.
- The legacy Redis queue is not intended to be exposed publicly.

## Security reminder

Secrets should live in local `.env` files and must not be committed.
