# Operations

## Installation

### Prerequisites

- Node.js 20+ (for `Blob`, `File`, and ESM support)
- npm

### First-Time Setup

```bash
cd /root/voicenotebot/streaming-dictation/backend

# Install dependencies
npm install

# Copy and edit environment file
cp .env.example .env
# Edit .env with your values (see Environment Variables below)

# Generate a password hash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 10).then(h => console.log(h))"
# Paste the output into .env as PASSWORD_HASH=...

# Build TypeScript
npm run build

# Start the service
systemctl start streaming-dictation
```

### Systemd Setup

Copy the service file and enable:

```bash
cp /root/voicenotebot/streaming-dictation/systemd/streaming-dictation.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable streaming-dictation
systemctl start streaming-dictation
```

## Deployment

Use the deploy script for routine updates:

```bash
bash /root/voicenotebot/streaming-dictation/scripts/deploy.sh
```

This script:
1. Checks for `.env` file
2. Runs `npm install`
3. Builds TypeScript (`npm run build`)
4. Restarts the systemd service
5. Shows service status and recent logs

Manual deployment:

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm install && npm run build
systemctl restart streaming-dictation
```

## Service Management

```bash
# Start
systemctl start streaming-dictation

# Stop
systemctl stop streaming-dictation

# Restart
systemctl restart streaming-dictation

# Check status
systemctl status streaming-dictation

# Enable on boot
systemctl enable streaming-dictation

# Disable on boot
systemctl disable streaming-dictation
```

## Logs

```bash
# Follow logs in real-time
journalctl -u streaming-dictation -f

# Last 100 lines
journalctl -u streaming-dictation -n 100 --no-pager

# Since yesterday
journalctl -u streaming-dictation --since yesterday

# Grep for errors
journalctl -u streaming-dictation | grep -i error
```

## Environment Variables

All variables are read from `/root/voicenotebot/streaming-dictation/backend/.env` via the systemd `EnvironmentFile` directive.

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
| `DATABASE_PATH` | No | `data/transcripts.db` | SQLite file path (relative to backend/) |

## Retention

Expired transcripts are cleaned up automatically every 60 minutes. The retention period is configurable via:

1. The `RETENTION_DAYS` env var (applied to new recordings)
2. The `PUT /api/settings` endpoint (updates the stored setting immediately)

The cleanup job runs `DELETE FROM transcripts WHERE expires_at < datetime('now')` and logs the count of deleted rows.

## Database

The SQLite database is stored at `backend/data/transcripts.db` by default. It uses WAL mode for better concurrent read performance.

```bash
# Check database size
ls -lh /root/voicenotebot/streaming-dictation/backend/data/transcripts.db

# Count transcripts
sqlite3 /root/voicenotebot/streaming-dictation/backend/data/transcripts.db \
  "SELECT COUNT(*) FROM transcripts;"

# Check expired transcripts
sqlite3 /root/voicenotebot/streaming-dictation/backend/data/transcripts.db \
  "SELECT COUNT(*) FROM transcripts WHERE expires_at < datetime('now');"

# Backup
cp /root/voicenotebot/streaming-dictation/backend/data/transcripts.db \
   /backup/transcripts-$(date +%Y%m%d).db
```

## Health Check

```bash
curl http://localhost:3100/health
```

Returns `{"status":"ok","timestamp":"..."}`.

## File Structure

```
streaming-dictation/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express app entry point
│   │   ├── config.ts             # Environment config
│   │   ├── db.ts                 # SQLite init + schema
│   │   ├── middleware/
│   │   │   └── auth.ts           # Session + requireAuth
│   │   ├── routes/
│   │   │   ├── auth.ts           # Login/logout/session
│   │   │   ├── recordings.ts     # Start/stream/finish
│   │   │   ├── transcripts.ts    # CRUD + search
│   │   │   ├── settings.ts       # GET/PUT settings
│   │   │   └── health.ts         # Health check
│   │   └── services/
│   │       ├── auth.ts           # bcrypt password verify
│   │       ├── stt.ts            # OpenAI transcription
│   │       ├── cleanup.ts        # Kimi/OpenAI cleanup
│   │       └── retention.ts      # Expired transcript cleanup
│   ├── tests/
│   │   ├── setup.ts              # In-memory test DB helper
│   │   ├── api.test.ts
│   │   ├── auth.test.ts
│   │   ├── cleanup.test.ts
│   │   ├── retention.test.ts
│   │   ├── settings.test.ts
│   │   ├── stt.test.ts
│   │   └── transcripts.test.ts
│   ├── data/                     # SQLite database (gitignored)
│   ├── dist/                     # Compiled TypeScript (gitignored)
│   ├── .env                      # Secrets (gitignored)
│   ├── .env.example
│   └── package.json
├── frontend/                     # React PWA
├── scripts/
│   └── deploy.sh
└── systemd/
    └── streaming-dictation.service
```
