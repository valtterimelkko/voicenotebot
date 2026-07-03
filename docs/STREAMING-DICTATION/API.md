# API Reference

Base URL: `http://localhost:3100`

All `/api/*` endpoints require authentication (session cookie). Unauthenticated requests return `401 { "error": "Authentication required" }`.

---

## Authentication

### POST /auth/login

Authenticate with password. Sets session cookie.

**Request:**

```json
{
  "password": "your-password"
}
```

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Password is required" }` | Missing or non-string password |
| 401 | `{ "error": "Invalid credentials" }` | Wrong password or no `PASSWORD_HASH` configured |

---

### POST /auth/logout

Destroy current session.

**Response (200):**

```json
{
  "ok": true
}
```

---

### GET /auth/session

Check if current session is authenticated.

**Response (200):**

```json
{
  "authenticated": true
}
```

```json
{
  "authenticated": false
}
```

---

## Recordings

### POST /api/recordings/start

Begin a new recording session. Returns a UUID for subsequent stream/finish calls.

**Request:** No body required.

**Response (200):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### POST /api/recordings/:id/stream

Send an audio chunk for the recording. Chunks are buffered in memory until finish.

**Request:**
- Content-Type: `application/octet-stream`
- Body: Raw binary audio data (WebM format)

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Empty or invalid audio chunk" }` | Non-buffer or empty body |
| 404 | `{ "error": "Recording session not found" }` | Unknown or already-finished recording ID |

---

### POST /api/recordings/:id/finish

Finalize recording: transcribe audio, run cleanup, store transcript.

**Request:** No body required.

**Response (200):** Full transcript object:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-04-23 14:30:00",
  "expires_at": "2026-05-07 14:30:00",
  "preview_text": "First 200 characters of cleaned text...",
  "raw_text": "Raw STT output...",
  "cleaned_text": "Cleaned up transcript...",
  "cleanup_model": "kimi",
  "stt_model": "gpt-4o-mini-transcribe",
  "used_fallback": 0,
  "duration_ms": 15420,
  "status": "completed"
}
```

If STT fails, `raw_text` and `cleaned_text` will be empty strings. If cleanup fails, `cleaned_text` falls back to `raw_text`.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 404 | `{ "error": "Recording session not found" }` | Unknown or already-finished recording ID |

---

## Transcripts

### GET /api/transcripts

List all transcripts, newest first.

**Response (200):**

```json
{
  "transcripts": [
    {
      "id": "...",
      "created_at": "...",
      "expires_at": "...",
      "preview_text": "...",
      "raw_text": "...",
      "cleaned_text": "...",
      "cleanup_model": "kimi",
      "stt_model": "gpt-4o-mini-transcribe",
      "used_fallback": 0,
      "duration_ms": 15420,
      "status": "completed"
    }
  ]
}
```

---

### GET /api/transcripts/search?q=...

Search transcripts by text content. Searches both `cleaned_text` and `raw_text` fields using LIKE.

**Query Parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `q` | No | Search term (case-insensitive substring match) |

**Response (200):**

```json
{
  "transcripts": [ ... ]
}
```

If `q` is empty or missing, returns `{ "transcripts": [] }`.

---

### GET /api/transcripts/:id

Get a single transcript by ID.

**Response (200):** Transcript object (same shape as individual items above).

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 404 | `{ "error": "Transcript not found" }` | No transcript with that ID |

---

### DELETE /api/transcripts/:id

Delete a transcript.

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 404 | `{ "error": "Transcript not found" }` | No transcript with that ID |

---

## Settings

### GET /api/settings

Get current user settings.

**Response (200):**

```json
{
  "default_cleanup_model": "kimi",
  "retention_days": 14
}
```

---

### PUT /api/settings

Update user settings. Supports partial updates.

**Request:**

```json
{
  "default_cleanup_model": "gpt-5-nano",
  "retention_days": 30
}
```

Both fields are optional. `default_cleanup_model` must be `"kimi"` or `"gpt-5-nano"`. `retention_days` must be a number.

**Response (200):** Updated settings object:

```json
{
  "default_cleanup_model": "gpt-5-nano",
  "retention_days": 30
}
```

---

## Health

### GET /health

Unauthenticated health check. Probes the SQLite connection with `SELECT 1`, so
it reflects whether the backend can actually serve requests — not just whether
the process is listening.

**Response (200):**

```json
{
  "status": "ok",
  "timestamp": "2026-04-23T14:30:00.000Z"
}
```

**Response (503)** — the database connection is unavailable:

```json
{
  "status": "degraded",
  "error": "The database connection is not open"
}
```

---

## Data Model

### Transcript

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Primary key |
| `created_at` | string | SQLite datetime, auto-generated |
| `expires_at` | string | ISO timestamp, `created_at + retention_days` |
| `preview_text` | string | First 200 characters of `cleaned_text` |
| `raw_text` | string | Direct STT output |
| `cleaned_text` | string | LLM-processed output |
| `cleanup_model` | string | `"kimi"` or `"gpt-5-nano"` |
| `stt_model` | string | `"gpt-4o-mini-transcribe"` |
| `used_fallback` | number | `1` if batch STT fallback was used, `0` otherwise |
| `duration_ms` | number \| null | Recording duration in milliseconds |
| `status` | string | Always `"completed"` |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3100` | Server port |
| `NODE_ENV` | No | `development` | Set to `production` for secure cookies |
| `SESSION_SECRET` | Yes | `dev-secret-change-in-prod` | Secret for session cookie signing |
| `PASSWORD_HASH` | Yes | (empty) | bcrypt hash of the login password |
| `OPENAI_API_KEY` | Yes | (empty) | OpenAI API key for STT and optional cleanup |
| `KIMI_API_KEY` | Yes | (empty) | Kimi API key for transcript cleanup |
| `DEFAULT_CLEANUP_MODEL` | No | `kimi` | Default LLM for cleanup: `kimi` or `gpt-5-nano` |
| `RETENTION_DAYS` | No | `14` | Days before transcripts are auto-deleted |
| `DATABASE_PATH` | No | `data/transcripts.db` | SQLite database file path |

---

## Kimi API Contract

- **Endpoint**: `https://api.kimi.com/coding/v1/chat/completions`
- **Headers**: `Authorization: Bearer <key>`, `User-Agent: KimiCLI/1.0`, `Content-Type: application/json`
- **Model**: `kimi-for-coding`
- **Temperature**: 0.3
- **Max tokens**: 60000
- **Timeout**: 300 seconds (read), abort via `AbortController`
- **Response**: `data.choices[0].message.content`
