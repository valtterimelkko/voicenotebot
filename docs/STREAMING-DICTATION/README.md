# Streaming Dictation

Streaming Dictation is the **primary current product** in this repository: a single-user, browser-based dictation app with transcript history, search, settings, retention, and AI cleanup.

It is designed for phone-first use, but the same app also works on desktop browsers.

## Start Here

- **Architecture and runtime behaviour:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **API reference:** [`API.md`](./API.md)
- **Authentication:** [`AUTH.md`](./AUTH.md)
- **Operations and deployment:** [`OPERATIONS.md`](./OPERATIONS.md)
- **Testing and current verification:** [`TESTING.md`](./TESTING.md)
- **Troubleshooting:** [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)
- **Backend implementation notes:** [`BACKEND.md`](./BACKEND.md)
- **Frontend implementation notes:** [`FRONTEND.md`](./FRONTEND.md)

## What It Does

The app captures audio from the browser microphone, streams chunks to the backend, transcribes the recording with OpenAI, cleans up the transcript with either Kimi or OpenAI, stores the result in SQLite, and makes it available in history and search.

## Current Behaviour

Implemented today:
- single-user password login with session cookies
- recording lifecycle: `start` → `stream` → `finish`
- OpenAI STT with fallback handling
- cleanup via **Kimi** or **OpenAI `gpt-5-nano`**
- transcript history, search, copy, and settings
- retention-based transcript cleanup
- warmup endpoint to reduce first-request latency
- speculative transcription during longer recordings
- visibility-aware polling for fresher history updates
- `no-store` caching on API responses to avoid stale transcript lists
- installable PWA shell

## Plain-English Request Flow

1. User logs in.
2. Frontend starts a recording with `POST /api/recordings/start`.
3. Browser microphone audio is captured with `MediaRecorder`.
4. Chunks are sent to `POST /api/recordings/:id/stream`.
5. For longer recordings, the backend may start speculative transcription before the user finishes.
6. User stops recording and the frontend calls `POST /api/recordings/:id/finish`.
7. Backend finalises transcription, applies cleanup, stores the transcript, and returns the record.
8. The transcript appears on the record screen and later in history/search.

## Product Boundaries

### Included

- single-user browser dictation
- transcript history and search
- copy-ready cleaned transcripts
- cleanup model selection in settings
- automatic transcript expiry/retention
- deployable backend + frontend bundle served from one backend process

### Not Included

- multi-user support
- native mobile apps
- true live word-by-word transcript rendering in the UI
- offline dictation
- external sync targets such as Notion/Google Docs/Telegram output for the new app

## Important Limitations

- The app is **installable as a PWA**, but it is **not an offline-first app**.
- In-progress recordings are currently kept **in memory** on the backend, so a restart loses active recording state.
- Remote microphone use requires **HTTPS** or localhost.
- Browser support depends on `getUserMedia` and `MediaRecorder` support.

## Key Paths

- **Backend source:** `streaming-dictation/backend/src/`
- **Frontend source:** `streaming-dictation/frontend/src/`
- **Service file:** `streaming-dictation/systemd/streaming-dictation.service`
- **Deploy script:** `streaming-dictation/scripts/deploy.sh`
- **Default port:** `3100`
- **Health check:** `GET /health`
