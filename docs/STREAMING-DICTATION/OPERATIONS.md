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

`/health` runs `SELECT 1` against the database, so it reports the backend's
real ability to serve requests. Healthy → `200 {"status":"ok",...}`; if the DB
connection is unavailable → `503 {"status":"degraded","error":"..."}`. Point any
uptime monitor here.

## Service Restart Policy

The systemd unit uses `Restart=always` (with a crash-loop guard): a stray
signal, OOM, or crash revives the service within `RestartSec`. The process
handles `SIGTERM`/`SIGINT` by closing the database and exiting cleanly so
systemd can restart it — it must not keep serving over a closed DB.

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
| `OPENAI_API_KEY` | Yes | (empty) | OpenAI API key (STT and cleanup) |
| `DEFAULT_CLEANUP_MODEL` | No | `google/gemma-4-26b-a4b-it` | informational; the cleanup service pins its model in code and `/api/settings` reports the truth |
| `XAI_API_KEY` | **Yes (for STT)** | — | xAI key; primary transcription via `https://api.x.ai/v1/stt` (falls back to local ASR, then OpenAI) |
| `OPENROUTER_API_KEY` | **Yes (for cleanup)** | — | OpenRouter key; cleanup runs on `google/gemma-4-26b-a4b-it` |
| `RETENTION_DAYS` | No | `14` | Auto-delete transcripts after N days |
| `DATABASE_PATH` | No | `data/transcripts.db` | SQLite file path |
| `FAILED_AUDIO_DIR` | No | `data/failed-audio` | where failed dictations keep their audio for 24 h (see Retention); empty turns it off |
| `FFMPEG_PATH` | No | `/usr/bin/ffmpeg` | ffmpeg used only to re-decode a recording the upstream transcribed in part (see Transcription Coverage); the absolute path is the default so the unit's `PATH` does not matter |
| `FORCE_AUDIO_NORMALISE` | No | off | `1` sends every dictation through the ffmpeg conversion — a laboratory switch for proving that path on a long real recording; leave it unset in production |

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

### Who else reads it: the Wheelhouse (Claude app connector)

Since 2026-10-26 the Wheelhouse command centre (`/root/command-centre`) opens this file **read-only** so the owner's
Claude app can list and read dictations and send one word for word to an agent. Why: the Claude app's voice mode cuts
the owner off at the first pause, so long instructions are dictated here and handed on by id. It reads the
`transcripts` columns `id`, `created_at`, `duration_ms`, `cleaned_text`, `raw_text` and `status`; renaming those or
moving the file breaks only the Wheelhouse's dictation tools, which then say they cannot read the history. Details:
`/root/command-centre/docs/plans/DICTATIONS.md` and its `docs/DEPENDENCIES.md`.

Since the same day it also **records** through this app: the Wheelhouse's large session view has a mic whose audio
the centre forwards to `/api/recordings/*` with the local service token (`SERVICE_TOKEN_FILE`; transcripts and
settings stay password-only), and it may `POST /api/recordings/:id/abort` to drop an unfinished recording. Those
dictations are saved in this history like any other. Details: `/root/command-centre/docs/plans/LARGE-VIEW.md`.

## Retention Behaviour

- Retention applies to saved transcript history.
- Expired transcripts are deleted automatically on an interval.
- The retention period can be changed via env or settings API.
- In-progress recordings are **not** protected by the database; they live in memory until finish.
- **Failed dictations keep their audio for 24 hours** (owner, 30 Oct 2026), for every caller (this PWA, the
  Wheelhouse web UI and apps). A finish that heard no words, whose transcription failed outright, or whose
  transcription covered only part of the recording (`short-decode`, see below) is kept:
  `data/failed-audio/<id>.audio` (the chunks joined in arrival order) and `<id>.json` (reason, duration, each
  chunk's size, the sniffed container, and `headerChunks` — which chunks open with a container header; a header
  anywhere but chunk 0 means the chunks arrived out of order). Folder 0700, files 0600, pruned at boot and hourly.
  The log line is `failed_audio_kept`. Successful dictations keep no audio.

## Transcription Coverage (long dictations, 11 Nov 2026)

A 3 min 15 s dictation on the Wheelhouse **Android** app came back as 739 characters — a bit more than a quarter
of what was said, ending mid-sentence — with no error and `status: completed`. The record is
`bea6cab5-6a1e-47e0-9341-703f0992d09c`: `duration_ms` 195,559, `stt_model` grok-voice-transcribe-2.0,
`used_fallback` 0, and 48 `/stream` posts (48 × 24,000 B ≈ 1.15 MB ≈ 191 s of the app's 48 kbit/s m4a), so the
whole file did arrive. The web composer's long dictations (WebM/Opus, streamed one chunk per second) were fine.

What was established on a disposable lab backend (never production):

- **xAI answers `200` with only the part of the audio it could decode**, and says how much it decoded in a
  `duration` field next to `text`. A recording whose container claims 278 s but whose media data stops at 56.7 s
  returns `{ text: <the first 56.7 s>, duration: 56.704 }` — no error, no warning. That is exactly the production
  shape (739 characters ≈ 57 s of speech, 4.0 chars per second of recording).
- **The container label is not the cause.** `stt.ts` has always posted every recording as `audio/webm` whatever
  arrived. A complete 278 s, 16 kHz mono, 48 kbit/s AAC/`.m4a` file with the phone's own atom layout
  (`ftyp`/`moov`-front/`free`/`mdat`) came back whole when labelled `audio/webm`: 45/45 sentences, 3,871 chars,
  13.9 chars/s. The host's local ASR accepted the same file with either label too. So sniffing the container to
  fix a label would have changed nothing; it was left alone.
- **Length and size are not the cause.** The same 278 s file (1.77 MB, 74 chunks) is transcribed whole.

What the backend now does (`/finish`, `src/routes/recordings.ts`):

1. xAI's `duration` is carried through as `STTResult.decodedSec`.
2. It is compared with the seconds the recording should hold — the server's `/start`→`/finish` clock, scaled to the
   chunks the transcript was made from (a reused speculative pass covers only the chunks it saw).
   `src/services/stt-coverage.ts`: a decode is short when it is more than 10 % (and more than 5 s) below that, so
   the Android app's few seconds of upload at Stop, and short dictations, are never false alarms.
3. **The retry changes the bytes** (`src/services/audio-normalise.ts`, `src/services/stt-recovery.ts`): a second
   identical request would decode the same part again, so ffmpeg re-decodes the whole recording to 16 kHz mono PCM
   WAV and slices it into ≤ 90 s parts (`-f segment`, 90 s), which are transcribed in order and stitched with a
   space. WAV was chosen over FLAC/Opus because it has no container to misread and was proven on the lab against
   both xAI and the host's local ASR. ffmpeg runs only here, with a 60 s timeout, in a private temp dir that is
   always removed; if ffmpeg is missing or fails, the previous behaviour (one plain retry) stands.
4. ffmpeg's own decoded duration (`-progress pipe:1`) separates the two cases:
   - it decodes ≥ 90 % of the recording → the audio was complete and the upstream lost part of it; the converted
     transcript is used when it covers more, and the row is `completed` with no note;
   - it decodes only what the upstream did → **the audio in hand is short** (the phone side): log `stt_audio_short`
     with both durations and make no upstream call, because nothing upstream can recover audio that is not there.
5. A transcript that is still short is stored and returned as **`completed`** with the words that were heard and
   **one plain note line** appended after cleanup (never handed to the cleanup model):
   `[Dictation cut short: only the first 0:57 of 3:16 was transcribed. The rest of the recording was lost.]`
   The audio is kept by the failed-audio store (`reason: short-decode`) for 24 h. This is deliberate: an `error`
   row reaches the apps as the centre's `422 NO_WORDS` ("No words were heard"), which throws away the words the
   owner did get (owner, 2026-11-12).

Log lines to grep for: `stt_short_decode_retry` (warn, with `decodedSec`/`expectedSec`/`forced`), `stt_audio_short`
(warn — the recording itself is short; both durations), `stt_short_decode` (warn — the transcript is partial and
carries the note), `stt_short_decode_retry_failed`, and `failed_audio_kept` with `reason: short-decode`.

The tiers that report no duration (the local ASR service, OpenAI gpt-transcribe) are never flagged, so the
fallback paths behave exactly as before.

Still open: *why* xAI decoded only 57 s of that complete 191 s file is not proven — the owner's audio was not kept
(the row completed before the failed-audio store could see it). The guard plus the conversion now answer the
question automatically on the next occurrence: `stt_audio_short` means the bytes on the wire were short (a
`wheelhouse-apps` recorder/upload matter — see the lane's proposal), while a recovered transcript means the file was
complete and the upstream was at fault. Either way the owner keeps the words that were heard plus one plain line
saying what is missing.

## Performance Notes

These are now part of normal runtime behaviour:
- warmup endpoint exists to reduce initial latency
- speculative transcription may begin before finish for longer recordings
- a transcript that covers only part of the recording is re-decoded with ffmpeg and transcribed in ≤ 90 s WAV
  parts; if the audio itself is short the words are kept with one plain note line and the audio is kept for 24 h
  (see Transcription Coverage above)
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
- backend lint passes
- frontend tests pass
- frontend typecheck passes
- frontend build passes

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

---

## Appendix — Legacy runbook

Historical maintainer notes preserved at [`docs/MAINTAINER-RUNBOOK.md`](../../docs/MAINTAINER-RUNBOOK.md).
