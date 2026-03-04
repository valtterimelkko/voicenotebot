---
task: "Build VoiceNote Bot - Telegram voice-to-text transcription system with Whisper + Kimi API"
created: "2026-03-04T07:45:00Z"
status: "pending"
risk_level: "medium"
estimated_effort: "large"
---

# VoiceNote Bot - Comprehensive Architecture Plan

## Summary

Build a robust, queue-based Telegram voice-to-text transcription bot using FastAPI (webhook), RQ (Redis Queue) workers, OpenAI Whisper (local), and Kimi API for transcript cleanup. The system handles max 2 concurrent Whisper jobs (4GB RAM peak), with Redis-based queuing for overflow. Features comprehensive error handling, retry logic with Telegram user notifications, and automated test suite.

## Analysis

### Components Required

| Component | Technology | Purpose |
|-----------|------------|---------|
| Webhook Service | FastAPI + Uvicorn | Receive Telegram webhooks, enqueue jobs |
| Job Queue | Redis + RQ | Queue management, job distribution |
| Worker Service | Python + RQ | Process voice notes (max 2 concurrent) |
| Transcription | Whisper (existing) | Speech-to-text conversion |
| Cleanup | Kimi API | Transcript editing (British spelling, filler removal) |
| Notifications | Telegram Bot API | Send results and error messages |

### Files to Create

1. `webhook/Dockerfile` - Webhook service container
2. `webhook/main.py` - FastAPI webhook handler
3. `webhook/requirements.txt` - Python dependencies
4. `worker/Dockerfile` - Worker service container
5. `worker/tasks.py` - Core transcription task logic
6. `worker/requirements.txt` - Python dependencies
7. `shared/models.py` - Shared data models (if needed)
8. `shared/telegram_client.py` - Telegram API wrapper
9. `shared/kimi_client.py` - Kimi API wrapper
10. `docker-compose.yml` - Complete orchestration
11. `tests/test_webhook.py` - Webhook service tests
12. `tests/test_tasks.py` - Worker task tests
13. `tests/test_integration.py` - End-to-end integration tests
14. `tests/conftest.py` - Test fixtures and configuration
15. `.env` - Environment variables (credentials)
16. `README.md` - Setup and usage documentation

### Dependencies

**External Services:**
- Telegram Bot API (webhook-based)
- Kimi API (api.kimi.com/coding/v1/chat/completions)
- Existing Whisper service (http://whisper:9000/asr)

**Infrastructure:**
- Redis (job queue)
- Docker + Docker Compose

**Python Libraries:**
- FastAPI + Uvicorn (webhook server)
- python-telegram-bot (Telegram API)
- redis + rq (job queue)
- httpx (HTTP client)
- pydantic (data validation)
- structlog (structured logging)
- pytest + pytest-asyncio (testing)

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Whisper OOM (2GB per job × 2 = 4GB) | Medium | High | Memory limits on workers, graceful degradation |
| Kimi API rate limiting | Medium | Medium | Exponential backoff, retry with delays |
| Telegram webhook timeout | Low | High | Immediate 200 OK response, async processing |
| Redis connection failure | Low | Critical | Health checks, auto-restart, queue persistence |
| Large voice files (>20MB) | Low | Medium | File size validation, user notification |
| Long voice notes (>5 min) | Medium | Medium | Token limit configuration, graceful error message |
| Worker crash mid-job | Low | High | RQ retry logic, failure notifications |
| Concurrent job overflow | Medium | Medium | Exactly 2 workers, Redis queue handles backlog |

## Implementation Plan

### Phase 1: Project Structure and Configuration
**Files:** `.env`, `docker-compose.yml`, `README.md`, `.env.example`
**Description:** Set up project structure, environment configuration, and orchestration
**Expected Outcome:** Project skeleton ready for development

### Phase 2: Shared Utilities
**Files:** `shared/telegram_client.py`, `shared/kimi_client.py`, `shared/logger.py`
**Description:** Create reusable clients for Telegram and Kimi API with proper error handling
**Expected Outcome:** Shared utilities tested and working

### Phase 3: Webhook Service
**Files:** `webhook/main.py`, `webhook/Dockerfile`, `webhook/requirements.txt`
**Description:** FastAPI service that receives Telegram webhooks and enqueues jobs
**Expected Outcome:** Webhook service accepts requests and creates RQ jobs

### Phase 4: Worker Service
**Files:** `worker/tasks.py`, `worker/Dockerfile`, `worker/requirements.txt`
**Description:** RQ worker that processes voice notes through Whisper → Kimi → Telegram
**Expected Outcome:** Worker successfully transcribes and returns cleaned text

### Phase 5: Comprehensive Test Suite
**Files:** `tests/conftest.py`, `tests/test_webhook.py`, `tests/test_tasks.py`, `tests/test_integration.py`
**Description:** Unit tests, integration tests, and mocking for external services
**Expected Outcome:** All tests passing, code coverage >80%

### Phase 6: Docker Integration and Deployment
**Files:** (verify docker-compose.yml)
**Description:** Build and run all containers, verify end-to-end flow
**Expected Outcome:** Complete system running locally

## Edge Cases to Handle

### 1. Voice Note Validation
- **Case:** User sends non-voice message (text, photo, etc.)
- **Handler:** Ignore silently, return 200 OK

- **Case:** Voice file > 20MB
- **Handler:** Send Telegram message: "❌ Voice note too large (max 20MB). Please send a shorter message."

- **Case:** Voice duration > 5 minutes (estimated)
- **Handler:** Process anyway but monitor Kimi token usage; if fails, send specific error

### 2. Telegram API Errors
- **Case:** File not found (deleted voice note)
- **Handler:** Log error, send "❌ Voice file expired. Please send again."

- **Case:** Chat not found (user blocked bot)
- **Handler:** Log and drop job silently

### 3. Whisper Service Errors
- **Case:** Whisper service unavailable (connection error)
- **Handler:** Retry with backoff; after 3 retries, notify user: "❌ Transcription service temporarily unavailable. Please try again later."

- **Case:** Whisper returns empty transcription (silence/unintelligible audio)
- **Handler:** Send "❌ Could not understand audio. Please speak clearly and try again."

- **Case:** Whisper OOM crash
- **Handler:** Worker container restarts, job marked failed, retries with next worker

### 4. Kimi API Errors
- **Case:** Rate limiting (429)
- **Handler:** Exponential backoff retry (1min, 5min, 10min)

- **Case:** Token limit exceeded (transcript too long)
- **Handler:** Send "❌ Voice note too long (max ~5 minutes). Please send a shorter message."

- **Case:** API key invalid/unauthorized
- **Handler:** Log critical error, notify admin (via log), job fails after retries

### 5. Queue and Worker Errors
- **Case:** Redis unavailable
- **Handler:** Webhook returns 503, Telegram retries; workers crash and restart

- **Case:** Worker dies mid-job
- **Handler:** RQ marks job as failed, retries up to 3 times; if final retry fails, notify user

- **Case:** Queue grows unbounded (spike of 100+ voice notes)
- **Handler:** Queue depth monitoring; if >100, workers process as capacity allows; users wait longer

### 6. Retry Exhaustion
- **Case:** All 3 retries failed for a job
- **Handler:** Send final message: "❌ Transcription failed after multiple attempts. Please try again or send a shorter voice note."

## Test Suite Design

### Unit Tests

**test_webhook.py:**
- Test webhook accepts valid Telegram voice message update
- Test webhook ignores non-voice messages
- Test webhook enqueues job with correct parameters
- Test webhook returns 200 OK immediately
- Test webhook handles invalid JSON

**test_telegram_client.py:**
- Test get_file method success
- Test get_file method failure (file not found)
- Test download_file method success
- Test send_message method success
- Test send_message handles chat not found

**test_kimi_client.py:**
- Test cleanup_transcript with valid input
- Test cleanup_transcript with API error
- Test cleanup_transcript with rate limiting
- Test token limit validation

**test_tasks.py:**
- Test process_voice_note success path
- Test process_voice_note with download failure
- Test process_voice_note with whisper failure
- Test process_voice_note with kimi failure
- Test retry logic triggers on failures

### Integration Tests

**test_integration.py:**
- Test end-to-end flow: webhook → queue → worker → telegram (mocked)
- Test concurrent job processing (verify max 2 parallel)
- Test queue behavior under load (5 rapid requests)
- Test failure recovery (simulate worker crash)

### Test Infrastructure

**conftest.py:**
- Fixtures for mocked Telegram API
- Fixtures for mocked Kimi API
- Fixtures for mocked Whisper service
- Redis test container setup
- Temporary file cleanup

## Kimi API Configuration Details

From the n8n workflow, the Kimi node configuration:
- **URL:** `https://api.kimi.com/coding/v1/chat/completions`
- **Method:** POST
- **Headers:**
  - `Authorization: Bearer <KIMI_API_KEY>`
  - `User-Agent: KimiCLI/1.0`
  - `Content-Type: application/json`
- **Body:**
```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a transcription editor. Clean up voice transcripts:\n1. If the text is English: convert to British spelling (colour, organise, prioritise, etc.)\n2. Remove any remaining filler words (um, uh, aah, öö, ääh, etc.)\n3. Fix obvious transcription errors\n4. Preserve the original language (don't translate)\n5. Keep the tone conversational but polished\n\nReturn ONLY the cleaned text, nothing else."
    },
    {
      "role": "user",
      "content": "Clean up this transcript:\n\n<transcript_text>"
    }
  ],
  "model": "kimi-for-coding",
  "temperature": 0.3,
  "max_tokens": 60000
}
```

## Credential Storage Decision

**Decision:** Store credentials in `.env` file locally, gitignored.

**Rationale:**
- GitHub repo is private, but .env is gitignored as defense in depth
- Docker Compose reads from .env automatically
- No secrets in code or version control
- Easy to rotate credentials without code changes
- Production deployment can use environment injection

**Credentials to store:**
- `TELEGRAM_BOT_TOKEN=8290487556:AAESCG6mdBniHMArtwTo9o3njA_76slpZg0`
- `KIMI_API_KEY=sk-kimi-UN323W6xKWlKl3Kzbd8XASAtKM2yqTL7WpDT3AvFZRbS9TSDpAogI3mDzmnJb4g7`
- `WEBHOOK_SECRET=<randomly_generated>`

## Verification Plan

- [ ] All containers build successfully
- [ ] Webhook service responds to health check
- [ ] Telegram webhook receives updates
- [ ] Jobs are enqueued in Redis
- [ ] Workers process jobs from queue
- [ ] Whisper transcription works end-to-end
- [ ] Kimi cleanup produces formatted text
- [ ] Telegram messages sent successfully
- [ ] Error messages sent on failures
- [ ] Retry logic functions correctly
- [ ] Concurrent job limit respected (max 2)
- [ ] Queue handles overflow gracefully
- [ ] All tests pass (pytest)

## Rollback Plan

If deployment fails:
1. Stop containers: `docker compose down`
2. Revert to n8n workflow (still active)
3. Check logs: `docker compose logs`
4. Fix issues, rebuild, redeploy

## Post-Deployment

1. Test with single voice note
2. Test with 3 rapid voice notes (queue test)
3. Test with long voice note (~5 min)
4. Test error handling (send invalid file)
5. Monitor logs for 24 hours
6. If stable, consider decommissioning n8n workflow
