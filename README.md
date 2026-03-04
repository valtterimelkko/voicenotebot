# VoiceNote Bot

A Telegram voice-to-text transcription bot built with FastAPI, RQ (Redis Queue), OpenAI Whisper, and Kimi API.

## Overview

VoiceNote Bot receives voice messages from Telegram users, transcribes them using OpenAI Whisper, and provides intelligent summaries and action items using the Kimi API. The system is designed with a worker queue architecture to handle concurrent transcription jobs efficiently while managing resource constraints.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Telegram      │────▶│    Webhook       │────▶│     Redis       │
│   (Voice Msg)   │     │   (FastAPI)      │     │    (Queue)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                            │
                              ┌─────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────────────────┐
              │                 Workers (2 replicas)        │
              │  ┌─────────────┐      ┌─────────────┐       │
              │  │  Worker 1   │      │  Worker 2   │       │
              │  │  (max 3GB)  │      │  (max 3GB)  │       │
              │  └─────────────┘      └─────────────┘       │
              └─────────────────────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────────────────┐
              │          External Whisper Service           │
              │          (OpenAI Whisper API)               │
              │              Port: 8000                     │
              └─────────────────────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────────────────┐
              │              Kimi API                       │
              │     (Summarization & Action Items)          │
              └─────────────────────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────────────────┐
              │           Telegram API                      │
              │      (Send transcription back)              │
              └─────────────────────────────────────────────┘
```

### Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Webhook | FastAPI | Receives Telegram webhooks, enqueues jobs |
| Queue | Redis | Manages transcription job queue |
| Workers | RQ + Python | Process voice transcriptions (max 2 concurrent) |
| Whisper | External Service | Speech-to-text conversion |
| Kimi API | External LLM | Summarization and action extraction |

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- Running Whisper service (external)
- Telegram Bot Token
- Kimi API Key

## Setup Instructions

### 1. Clone and Navigate

```bash
cd /root/voicenotebot
```

### 2. Configure Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
WEBHOOK_SECRET=your_webhook_secret_here

# Kimi AI
KIMI_API_KEY=your_kimi_api_key_here

# Redis (uses service name in Docker)
REDIS_URL=redis://redis:6379/0

# Whisper Service URL (external container)
WHISPER_URL=http://whisper:8000

# Logging
LOG_LEVEL=INFO
```

### 3. External Whisper Network Setup

The Whisper service is already running via Docker Compose at `/root/whisper/`. The bot connects to it through the `whisper_network` external network.

If the network connection needs to be established:

```bash
# Connect whisper container to the shared network
docker network connect n8n-docker-caddy_default whisper
```

Verify the whisper container is accessible:

```bash
docker ps | grep whisper
```

### 4. Build and Start Services

```bash
# Build all services
docker compose build

# Start all services
docker compose up -d

# Or combine build and start
docker compose up -d --build
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Telegram Bot API token from @BotFather |
| `KIMI_API_KEY` | Yes | - | Kimi API access key |
| `REDIS_URL` | No | `redis://redis:6379/0` | Redis connection string |
| `WHISPER_URL` | No | `http://whisper:8000` | Whisper service endpoint |
| `WEBHOOK_SECRET` | Yes | - | Secret for webhook validation |
| `LOG_LEVEL` | No | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR) |

See `.env.example` for the complete list of configuration options.

## Running the System

### Start Services

```bash
docker compose up -d
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f webhook
docker compose logs -f worker
docker compose logs -f redis
```

### Stop Services

```bash
docker compose down
```

### Stop and Remove Volumes

```bash
docker compose down -v
```

## Testing

### 1. Health Check

```bash
# Check webhook health
curl http://localhost:8000/health
```

### 2. Redis Connection

```bash
# Connect to Redis
docker compose exec redis redis-cli ping
# Expected: PONG
```

### 3. Test Telegram Webhook

Set the webhook URL in Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-domain.com/webhook"}'
```

### 4. Send Test Voice Message

Send a voice message to your Telegram bot and check the logs:

```bash
docker compose logs -f worker
```

## Monitoring/Logs

### Real-time Log Monitoring

```bash
# Follow all logs
docker compose logs -f

# Follow with timestamps
docker compose logs -f --timestamps

# Last 100 lines
docker compose logs --tail=100
```

### Worker Queue Status

```bash
# Connect to Redis and check queue
docker compose exec redis redis-cli LLEN rq:queue:default

# Monitor RQ queues
docker compose exec redis redis-cli MONITOR
```

### Resource Usage

```bash
# Container stats
docker stats voicenotebot-webhook voicenotebot-redis

# All project containers
docker compose ps
```

## Troubleshooting

### Webhook Not Responding

```bash
# Check webhook container logs
docker compose logs webhook

# Verify health endpoint
curl -v http://localhost:8000/health
```

### Workers Not Processing Jobs

```bash
# Check worker logs
docker compose logs worker

# Verify Redis connection
docker compose exec worker python -c "import redis; r = redis.from_url('redis://redis:6379/0'); print(r.ping())"

# Check queue length
docker compose exec redis redis-cli LLEN rq:queue:default
```

### Whisper Service Unreachable

```bash
# Test whisper connectivity from worker
docker compose exec worker curl http://whisper:8000/health

# Verify network connection
docker network inspect n8n-docker-caddy_default
```

### Memory Issues

Workers are limited to 3GB RAM each. If transcription fails:

```bash
# Check container memory usage
docker stats --no-stream

# Restart workers
docker compose restart worker
```

### Redis Connection Errors

```bash
# Restart Redis
docker compose restart redis

# Check Redis data volume
docker volume inspect voicenotebot_redis_data
```

## Security Notes

1. **Environment Variables**: Never commit `.env` files to version control. The `.dockerignore` file excludes them.

2. **Webhook Secret**: Always set a strong `WEBHOOK_SECRET` to validate incoming Telegram webhooks.

3. **Network Isolation**: Services communicate through isolated Docker networks:
   - `default`: Internal communication between bot services
   - `whisper_network`: External network for Whisper service access

4. **Container Permissions**: Services run as non-root users where possible (configured in Dockerfiles).

5. **Resource Limits**: Workers have strict memory limits (3GB) to prevent resource exhaustion.

6. **Redis**: Not exposed to the public internet (only internal network access).

7. **API Keys**: Rotate `TELEGRAM_BOT_TOKEN` and `KIMI_API_KEY` regularly.

---

## Development

For local development without Docker:

```bash
# Install dependencies
pip install -r webhook/requirements.txt
pip install -r worker/requirements.txt

# Start Redis locally
redis-server

# Run webhook
python webhook/main.py

# Run worker
python worker/worker.py
```
