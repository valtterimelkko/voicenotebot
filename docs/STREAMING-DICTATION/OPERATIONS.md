# Operations

## Deployment Model

Streaming Dictation runs as a **systemd-managed Node.js service** and is expected to sit behind **Caddy/HTTPS** in production.

The backend serves both:
- the REST API
- the built frontend static assets

That means one service on port `3100` is the operational centre of the app.

## Prerequisites

- Node.js 20+
- npm
- systemd
- Caddy or equivalent reverse proxy for HTTPS in production

## First-Time Setup

### 1) Backend

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm install
cp .env.example .env
```

Generate a password hash:

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 10).then(h => console.log(h))"
```

Put the output into `.env` as `PASSWORD_HASH=...`.

Then build the backend:

```bash
npm run build
```

### 2) Frontend

```bash
cd /root/voicenotebot/streaming-dictation/frontend
npm install
npm run build
```

### 3) Install the service file

```bash
cp /root/voicenotebot/streaming-dictation/systemd/streaming-dictation.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable streaming-dictation
systemctl start streaming-dictation
```

## Routine Deployment

Use the deploy script for normal updates:

```bash
bash /root/voicenotebot/streaming-dictation/scripts/deploy.sh
```

What it does:
1. checks that backend `.env` exists
2. installs backend dependencies
3. builds backend TypeScript
4. installs frontend dependencies
5. builds the frontend bundle
6. restarts the `streaming-dictation` systemd service
7. shows recent service status/logs

## Service Management

```bash
systemctl start streaming-dictation
systemctl stop streaming-dictation
systemctl restart streaming-dictation
systemctl status streaming-dictation
systemctl enable streaming-dictation
systemctl disable streaming-dictation
```

## Logs

```bash
journalctl -u streaming-dictation -f
journalctl -u streaming-dictation -n 100 --no-pager
journalctl -u streaming-dictation --since today
journalctl -u streaming-dictation | grep -i error
```

## Health Checks

```bash
curl http://localhost:3100/health
```

Expected shape:

```json
{"status":"ok","timestamp":"..."}
```

## Reverse Proxy Notes

Production behaviour depends on correct reverse-proxy setup.

Important points:
- Express is configured with `trust proxy`
- secure session cookies depend on HTTPS and correct proxy forwarding
- microphone access from remote devices requires HTTPS
- if login appears broken only in production, check the proxy before assuming the app code is wrong

## Environment Variables

All variables are read from `/root/voicenotebot/streaming-dictation/backend/.env`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3100` | Server listen port |
| `NODE_ENV` | No | `development` | Set to `production` for secure cookies |
| `SESSION_SECRET` | Yes | `dev-secret-change-in-prod` | Session signing secret |
| `PASSWORD_HASH` | Yes | (empty) | bcrypt hash for login |
| `OPENAI_API_KEY` | Yes | (empty) | OpenAI API key |
| `KIMI_API_KEY` | Yes | (empty) | Kimi API key |
| `DEFAULT_CLEANUP_MODEL` | No | `kimi` | `kimi` or `gpt-5-nano` |
| `RETENTION_DAYS` | No | `14` | Auto-delete transcripts after N days |
| `DATABASE_PATH` | No | `data/transcripts.db` | SQLite file path |

## Database

Default location:

```bash
/root/voicenotebot/streaming-dictation/backend/data/transcripts.db
```

Useful checks:

```bash
# Database file size
ls -lh /root/voicenotebot/streaming-dictation/backend/data/transcripts.db

# Transcript count
sqlite3 /root/voicenotebot/streaming-dictation/backend/data/transcripts.db \
  "SELECT COUNT(*) FROM transcripts;"

# Expired transcript count
sqlite3 /root/voicenotebot/streaming-dictation/backend/data/transcripts.db \
  "SELECT COUNT(*) FROM transcripts WHERE expires_at < datetime('now');"
```

### Backup

```bash
cp /root/voicenotebot/streaming-dictation/backend/data/transcripts.db \
   /backup/transcripts-$(date +%Y%m%d).db
```

## Retention Behaviour

- Retention applies to saved transcript history.
- Expired transcripts are deleted automatically on an interval.
- The retention period can be changed via env or settings API.
- In-progress recordings are **not** protected by the database; they live in memory until finish.

## Performance Notes

These are now part of normal runtime behaviour:
- warmup endpoint exists to reduce initial latency
- speculative transcription may begin before finish for longer recordings
- API responses are intentionally `no-store`
- history polling is visibility-aware rather than constant in the background

These are expected behaviours, not bugs.

## Verification Commands

### Backend

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm test
npm run typecheck
npm run lint
```

### Frontend

```bash
cd /root/voicenotebot/streaming-dictation/frontend
npm test
npm run typecheck
npm run build
```

## Current Known Verification Note

At the time of this documentation update:
- backend tests pass
- backend typecheck passes
- frontend tests pass
- frontend typecheck passes
- frontend build passes
- backend lint currently fails because ESLint v9 expects a flat `eslint.config.*` file

Treat that lint issue as a tooling/config task rather than a product runtime failure.

## File Structure

```text
streaming-dictation/
├── backend/
│   ├── src/
│   ├── tests/
│   ├── data/
│   ├── .env
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   ├── public/
│   └── package.json
├── scripts/
│   └── deploy.sh
└── systemd/
    └── streaming-dictation.service
```
