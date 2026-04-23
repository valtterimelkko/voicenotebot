# VoiceNote Bot

This repository contains two related voice-to-text systems:

1. **Legacy Telegram Bot** — Queue-based Telegram bot using FastAPI + RQ + local Whisper + Kimi cleanup. See [documentation below](#architecture).
2. **Streaming Dictation** — Browser-based voice dictation web app using Node.js + Express + SQLite + OpenAI STT + Kimi/OpenAI cleanup. See [Streaming Dictation docs](./docs/STREAMING-DICTATION/README.md).

---

## Legacy Telegram Bot

A robust, queue-based Telegram voice-to-text transcription bot using FastAPI, RQ (Redis Queue), OpenAI Whisper (local), and Kimi API for transcript cleanup.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VoiceNote Bot Architecture                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────┐  │
│   │ Telegram │────▶│  Caddy Proxy │────▶│   Webhook    │────▶│  Redis   │  │
│   │   Bot    │     │   (HTTPS)    │     │   (FastAPI)  │     │  Queue   │  │
│   └──────────┘     └──────────────┘     └──────────────┘     └────┬─────┘  │
│         ▲                                                         │        │
│         │                                                         ▼        │
│         │                              ┌─────────────────────────────────┐ │
│         │                              │           Workers               │ │
│         │                              │  ┌─────────────┐ ┌────────────┐ │ │
│         │                              │  │ Worker 1    │ │ Worker 2   │ │ │
│         │                              │  │ (max 3GB)   │ │ (max 3GB)  │ │ │
│         │                              │  └──────┬──────┘ └─────┬──────┘ │ │
│         │                              └─────────┼──────────────┼────────┘ │
│         │                                        │              │          │
│         │                                        └──────┬───────┘          │
│         │                                               │                  │
│         │                                               ▼                  │
│         │                              ┌─────────────────────────────────┐ │
│         │                              │     External Services           │ │
│         │                              │  ┌──────────┐  ┌─────────────┐  │ │
│         │                              │  │ Whisper  │  │  Kimi API   │  │ │
│         │                              │  │ (local)  │  │  (remote)   │  │ │
│         │                              │  └──────────┘  └─────────────┘  │ │
│         │                              └─────────────────────────────────┘ │
│         │                                                                   │
│         └───────────────────────────────────────────────────────────────────┘
│                                    (Send transcription result back)         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Services & Components

### Core Services

| Service | Technology | Purpose | Location |
|---------|------------|---------|----------|
| **Webhook** | FastAPI + Uvicorn | Receives Telegram webhooks, enqueues jobs | `webhook/` |
| **Worker** | Python + RQ | Processes voice notes (2 replicas) | `worker/` |
| **Queue** | Redis | Job queue management | Docker container |
| **Shared** | Python modules | Telegram client, Kimi client, logger | `shared/` |

### External Dependencies

| Service | Location | Description |
|---------|----------|-------------|
| **Whisper** | `/root/whisper/` | Local OpenAI Whisper ASR service |
| **Kimi API** | `api.kimi.com` | Remote LLM for transcript cleanup |
| **Telegram** | `api.telegram.org` | Telegram Bot API |

### Whisper Concurrency Control

To prevent performance degradation, Whisper access is controlled via **Redis distributed locks**:
- Only **1 worker** can use Whisper at a time
- Additional workers wait with exponential backoff
- Prevents 10-20x slowdown from CPU contention

## Whisper Service Details

The local Whisper service is located at `/root/whisper/` and runs as a separate Docker container.

### API Endpoint

```
POST http://whisper:9000/asr
```

### Request Format

```python
files = {"audio_file": (filename, file_content, mime_type)}
data = {"language": "auto"}

# Supported MIME types:
# - audio/ogg (.oga, .ogg)
# - audio/mpeg (.mp3)
# - audio/mp4 (.m4a)
# - audio/wav (.wav)
# - audio/webm (.webm)
```

### Response Format

Whisper returns the transcription as **plain text** (not JSON):

```
This is the transcribed text from the voice note.
```

## Logging Strategy

All services use **structured logging** with [structlog](https://www.structlog.org/):

- **Format**: JSON in production, colored console in development
- **Levels**: INFO for normal operations, DEBUG for troubleshooting
- **Fields**: timestamp, level, filename, lineno, and contextual data

### Log Locations

```bash
# View webhook logs
docker logs -f voicenotebot-webhook

# View worker logs
docker logs -f voicenotebot-worker-1
docker logs -f voicenotebot-worker-2

# View Redis logs
docker logs -f voicenotebot-redis
```

### Key Log Events

| Event | Level | Description |
|-------|-------|-------------|
| `webhook_processed_successfully` | INFO | Voice message received and queued |
| `transcription_job_enqueued` | INFO | Job added to Redis queue |
| `Whisper transcription successful` | INFO | ASR completed |
| `Whisper transcription complete - RAW OUTPUT` | INFO | **Full Whisper output for debugging** |
| `Kimi cleanup complete - RAW OUTPUT` | INFO | **Full Kimi output for comparison** |
| `transcript_cleaned` | INFO | Kimi cleanup completed |
| `Voice note transcription complete` | INFO | Full pipeline succeeded |
| `Whisper transcription error` | ERROR | ASR failed with details |
| `Waiting for Whisper lock` | INFO | Worker waiting for Whisper access |
| `Whisper lock acquired` | INFO | Worker obtained exclusive Whisper access |

### Debug Logging for Gibberish Issues

To diagnose transcription quality issues, the worker now logs **raw output** from both services:

```bash
# View raw Whisper vs Kimi output
docker logs voicenotebot-worker-1 | grep "RAW OUTPUT"

# Check for differences between Whisper and Kimi
docker logs voicenotebot-worker-1 | grep "was_modified"

# Monitor lock acquisition
docker logs voicenotebot-worker-1 | grep -E "(lock|waiting)"
```

Each log entry includes:
- `transcript_preview`: First 500 chars of output
- `transcript_hash`: Hash for easy comparison
- `was_modified`: Whether Kimi changed the Whisper output

## Quick Start

### Prerequisites

- Docker & Docker Compose installed
- Telegram Bot Token (from @BotFather)
- Kimi API Key
- Existing Whisper service running at `/root/whisper/`

### Environment Setup

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` with your credentials:
```bash
TELEGRAM_BOT_TOKEN=your_token_here
KIMI_API_KEY=your_key_here
```

### Start Services

```bash
# Start all services
docker compose up -d

# Verify all containers are running
docker compose ps

# Check health endpoint
curl http://localhost:9999/health
```

### Stop Services

```bash
# Stop all services gracefully
docker compose down

# Stop and remove all data (including Redis queue)
docker compose down -v
```

### Restart Services

```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart worker
docker compose restart webhook
```

## Debugging Guide

### Check Service Status

```bash
# List all containers
docker compose ps

# Check resource usage
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.Status}}"
```

### Monitor Queue

```bash
# Check pending jobs
docker exec voicenotebot-redis redis-cli LLEN rq:queue:default

# Check failed jobs
docker exec voicenotebot-redis redis-cli ZCARD rq:failed:default

# View failed job details
docker exec voicenotebot-redis redis-cli ZRANGE rq:failed:default 0 -1

# Clear failed jobs
docker exec voicenotebot-redis redis-cli DEL rq:failed:default
```

### Debug Worker Issues

```bash
# Follow worker logs in real-time
docker logs -f voicenotebot-worker-1

# Check for import errors
docker exec voicenotebot-worker-1 python3 -c "from tasks import process_voice_note; print('OK')"

# Test Whisper connectivity
docker exec voicenotebot-worker-1 python3 -c "
import httpx
r = httpx.get('http://whisper:9000/health', timeout=10)
print(f'Status: {r.status_code}')
"
```

### Debug Webhook Issues

```bash
# Test webhook locally
curl -X POST http://localhost:9999/webhook \
  -H "Content-Type: application/json" \
  -d '{"message":{"voice":{"file_id":"test"},"chat":{"id":123}}}'

# Check Telegram webhook status
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"

# View webhook logs
docker logs voicenotebot-webhook --tail 50
```

### Common Issues

| Issue | Solution |
|-------|----------|
| Worker can't find tasks | Check `tasks.py` exists at root, rebuild workers |
| Whisper returns empty | Verify MIME type is set (audio/ogg for .oga files) |
| **Transcription is gibberish/wrong language** | Check `RAW OUTPUT` logs to see if issue is Whisper or Kimi |
| **Slow transcription (5+ minutes)** | Check `Waiting for Whisper lock` - may be queued behind another job |
| Kimi API errors | Check API key, verify token limits |
| Queue growing | Check worker logs for errors, ensure 2 workers running |
| Webhook 404 | Verify Caddy config, check webhook URL |

## Production Deployment

### Persistence & Restart Policy

All containers are configured with `restart: always` to:
- Restart on crash
- Start automatically after server reboot
- Recover from Docker daemon restarts

### Resource Limits

- **Worker**: 3GB RAM limit per worker (2 workers max = 6GB peak)
- **Webhook**: Minimal resources (stateless)
- **Redis**: Uses volume for data persistence

### Monitoring

```bash
# Set up a simple health check script
#!/bin/bash
# health_check.sh

if ! curl -sf http://localhost:9999/health > /dev/null; then
    echo "$(date): Webhook unhealthy, restarting..."
    docker compose restart webhook
fi
```

### Backup

```bash
# Backup Redis data
docker exec voicenotebot-redis redis-cli SAVE
docker cp voicenotebot-redis:/data/dump.rdb /backup/redis-$(date +%Y%m%d).rdb
```

## File Structure

```
.
├── docker-compose.yml      # Container orchestration
├── .env                    # Environment variables (not in git)
├── .env.example            # Environment template
├── .gitignore              # Git ignore rules
├── tasks.py                # Root-level RQ task exports
├── shared/                 # Shared utilities
│   ├── __init__.py
│   ├── logger.py          # Structured logging
│   ├── telegram_client.py # Telegram API wrapper
│   ├── kimi_client.py     # Kimi API wrapper
│   └── requirements.txt
├── webhook/               # FastAPI webhook service
│   ├── Dockerfile
│   ├── main.py
│   └── requirements.txt
├── worker/                # RQ worker service
│   ├── Dockerfile
│   ├── tasks.py          # Main processing logic
│   └── requirements.txt
└── tests/                 # Test suite
    ├── conftest.py
    ├── test_webhook.py
    ├── test_tasks.py
    └── test_integration.py
```

## Development

### Running Tests

```bash
# Install test dependencies
pip install -r tests/requirements.txt

# Run all tests
pytest tests/

# Run with coverage
pytest tests/ --cov=shared --cov=worker --cov=webhook
```

### Rebuilding After Changes

```bash
# Rebuild specific service
docker compose build worker
docker compose up -d --force-recreate worker

# Rebuild all
docker compose build
docker compose up -d
```

## Security Notes

- `.env` file contains secrets and is **gitignored**
- Redis is not exposed externally (no port mapping)
- **Webhook binds to localhost only** (`127.0.0.1:9999`) - prevents external scanner access
- Webhook uses HTTPS via Caddy reverse proxy
- Workers have memory limits to prevent OOM crashes
- Docker log rotation configured (10MB × 5 files max)

## License

Private - For personal use only.

## Troubleshooting Support

For issues or questions, check the logs first:
```bash
docker compose logs -f --tail 100
```

Then refer to the [Debugging Guide](#debugging-guide) section above.
