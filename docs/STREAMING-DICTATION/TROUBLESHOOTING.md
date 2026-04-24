# Troubleshooting

## Missing Environment Variables

**Symptom**: Login always returns 401, or API calls fail.

**Check**:

```bash
grep -E '(PASSWORD_HASH|OPENAI_API_KEY|KIMI_API_KEY|SESSION_SECRET)' \
  /root/voicenotebot/streaming-dictation/backend/.env
```

`PASSWORD_HASH` must be a bcrypt hash, not a plaintext password.

---

## Login / Session Works Locally but Fails Behind Proxy

**Symptom**: The app behaves correctly on localhost, but login/session handling breaks in production.

**Likely cause**: Reverse-proxy forwarding or HTTPS cookie setup is wrong.

**Check**:
- service is running behind HTTPS
- proxy forwards requests correctly to port `3100`
- `NODE_ENV=production` is set when using secure cookies
- browser is actually receiving/sending the session cookie

**Why this matters**: The app depends on correct reverse-proxy behaviour for secure session cookies.

---

## OpenAI STT Failures

**Symptom**: Recordings finish with empty `raw_text` and `cleaned_text`, or transcripts come back blank.

**Check logs**:

```bash
journalctl -u streaming-dictation | grep -i 'stt\|transcription\|openai'
```

**Common causes**:
- invalid or expired `OPENAI_API_KEY`
- unsupported/invalid audio payload
- network connectivity issues to OpenAI
- model availability/account issues

**Behaviour to expect**:
- the app first tries its primary STT path
- if that fails, it attempts a fallback path
- if both fail, the transcript may be stored with empty text

---

## Kimi Cleanup Failures

**Symptom**: `cleaned_text` is identical to `raw_text`, or transcripts appear uncleaned.

**Check logs**:

```bash
journalctl -u streaming-dictation | grep -i kimi
```

**Common causes**:
- invalid `KIMI_API_KEY`
- Kimi API timeout or rate limit
- network issues

**Expected fallback behaviour**:
- if cleanup fails, the app keeps the raw transcript rather than failing the whole recording

**Temporary mitigation**:
Switch cleanup to OpenAI:

```bash
curl -X PUT http://localhost:3100/api/settings \
  -H 'Content-Type: application/json' \
  -b cookie.txt \
  -d '{"default_cleanup_model":"gpt-5-nano"}'
```

---

## History Page Looks Stale

**Symptom**: A newly finished transcript does not immediately appear in history, or history seems old after returning to the tab.

**Current behaviour**:
- history polling is visibility-aware
- hidden tabs pause polling
- returning to a visible tab triggers a refresh
- API responses are intentionally `no-store`

**What to check**:
- bring the tab back into focus
- confirm requests are actually reaching `/api/transcripts`
- hard refresh if you suspect an old frontend bundle after deploy

If the issue only happens after deployment, also verify that the frontend bundle and backend code were both rebuilt.

---

## Warmup Endpoint Confusion

**Symptom**: You see `/api/recordings/warmup` in logs and are unsure whether something is wrong.

**Explanation**:
This is a normal latency-reduction endpoint. It exists to warm external connections before or around recording use. It is a performance optimisation, not an error path.

---

## Speculative Transcription Confusion

**Symptom**: A longer recording finishes faster than expected, or logs suggest transcription work began before `finish`.

**Explanation**:
This is normal. The backend can begin speculative transcription during longer recordings to reduce wait time after stop.

---

## Microphone Permission Denied

**Symptom**: Frontend cannot start recording.

**Fix**:
- allow microphone access in the browser
- confirm the browser/device has an available microphone
- ensure you are using HTTPS or localhost

**Important**:
Remote microphone access will not work reliably on plain `http://<ip>:3100` from another device.

---

## Mobile Browser Issues

**Symptom**: Recording fails on iPhone/iPad/Android, or stops when the screen locks.

**Common causes**:
- browser-specific `MediaRecorder` limitations
- iOS/Safari permission quirks
- screen lock/backgrounding interrupting capture
- browser codec support differences

**What to try**:
- keep the screen awake during recording
- retry after reloading the page
- test in a current version of Chrome/Safari
- verify HTTPS is in place

---

## Session Expired

**Symptom**: API requests return `401 { "error": "Authentication required" }`.

**Cause**:
- session expired
- cookie missing
- server/proxy/cookie mismatch after restart or deploy

**Fix**:
Log in again.

CLI example:

```bash
curl -X POST http://localhost:3100/auth/login \
  -H 'Content-Type: application/json' \
  -c cookie.txt \
  -d '{"password":"your-password"}'
```

---

## Database Locked / SQLITE_BUSY

**Symptom**: `SQLITE_BUSY` errors appear in logs.

**Check**:

```bash
lsof /root/voicenotebot/streaming-dictation/backend/data/transcripts.db
```

**Fix**:

```bash
systemctl restart streaming-dictation
```

Under normal single-user use this should be rare, but concurrent access from other processes can still cause problems.

---

## In-Progress Recording Lost After Restart

**Symptom**: A user was recording, the service restarted, and the recording disappeared.

**Explanation**:
This is expected with the current design. Active recordings are stored in memory until `finish` is called; they are not checkpointed to the database.

---

## Service Won't Start

**Check**:

```bash
journalctl -u streaming-dictation -n 50 --no-pager
ls -la /root/voicenotebot/streaming-dictation/backend/.env
ls -la /root/voicenotebot/streaming-dictation/backend/dist/index.js
node --version
```

Try running manually:

```bash
cd /root/voicenotebot/streaming-dictation/backend
node dist/index.js
```

---

## Frontend Looks Old After Deploy

**Symptom**: The backend is updated, but the UI still looks outdated or behaves like old code.

**Check**:
- the deploy script rebuilt the frontend
- `streaming-dictation/frontend/dist/` contains fresh files
- the service was restarted after the build
- browser cache was refreshed

Use the normal deploy script to avoid partial updates:

```bash
bash /root/voicenotebot/streaming-dictation/scripts/deploy.sh
```

---

## Backend Lint Fails

**Symptom**: `npm run lint` fails in `streaming-dictation/backend`.

**Current note**:
The backend now uses an ESLint flat config. If lint fails again, check that dependencies were installed with dev dependencies included:

```bash
cd /root/voicenotebot/streaming-dictation/backend
npm install --include=dev
npm run lint
```

If the config file is missing, verify `eslint.config.mjs` exists in the backend directory.
