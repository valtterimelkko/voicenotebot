# Troubleshooting

## Missing Environment Variables

**Symptom**: Login always returns 401, or API calls fail silently.

**Check**: Verify all required vars are set in `.env`:

```bash
grep -E '(PASSWORD_HASH|OPENAI_API_KEY|KIMI_API_KEY|SESSION_SECRET)' \
  /root/voicenotebot/streaming-dictation/backend/.env
```

`PASSWORD_HASH` must be a bcrypt hash (starts with `$2b$...`), not a plaintext password.

---

## OpenAI STT Failures

**Symptom**: Recordings finish with empty `raw_text` and `cleaned_text`.

**Check logs**:

```bash
journalctl -u streaming-dictation | grep -i "STT\|transcription\|openai"
```

**Common causes**:
- Invalid or expired `OPENAI_API_KEY`
- Audio chunks too small or corrupted
- Network connectivity to `api.openai.com`
- Model `gpt-4o-mini-transcribe` not available on your plan

The system attempts a fallback: if `streamTranscribe()` fails, `batchTranscribe()` is tried. If both fail, the transcript is saved with empty text.

---

## Kimi Cleanup Failures

**Symptom**: `cleaned_text` is identical to `raw_text` (cleanup was skipped).

**Check logs**:

```bash
journalctl -u streaming-dictation | grep -i "kimi"
```

**Common causes**:
- Invalid `KIMI_API_KEY`
- Kimi API rate limiting (HTTP 429)
- Request timeout (300s limit exceeded for very long transcripts)
- Network connectivity to `api.kimi.com`

**Mitigation**: If Kimi is unreliable, switch to OpenAI cleanup:

```bash
# In .env
DEFAULT_CLEANUP_MODEL=gpt-5-nano
```

Or update via API:

```bash
curl -X PUT http://localhost:3100/api/settings \
  -H "Content-Type: application/json" \
  -b cookie.txt \
  -d '{"default_cleanup_model":"gpt-5-nano"}'
```

---

## Microphone Permission Denied

**Symptom**: Frontend cannot start recording, browser shows permission prompt or error.

**Fix**: This is a browser/OS issue, not a backend issue.

- Chrome: Settings > Privacy and security > Site Settings > Microphone
- Firefox: URL bar > camera icon > Allow microphone
- Safari: Safari > Settings > Websites > Microphone
- **Important**: Microphone access requires HTTPS or localhost. The PWA will not work on `http://<ip>:3100` from a remote device without HTTPS.

---

## Mobile Browser Issues

**Symptom**: Recording doesn't work on iOS Safari or Android Chrome.

**Common issues**:
- iOS Safari requires user gesture to start audio capture
- Some mobile browsers don't support `MediaRecorder` with WebM codec
- Audio capture stops when the screen locks

**Check**: Open browser developer tools (if available) for Web Audio API errors.

---

## Session Expired

**Symptom**: API requests return `401 { "error": "Authentication required" }`.

**Cause**: Session cookie expired (TTL is 7 days) or server was restarted (in-memory session store resets if not using persistent store).

**Fix**: Re-authenticate:

```bash
curl -X POST http://localhost:3100/auth/login \
  -H "Content-Type: application/json" \
  -c cookie.txt \
  -d '{"password":"your-password"}'
```

---

## Database Locked

**Symptom**: `SQLITE_BUSY` errors in logs.

**Cause**: SQLite database is being accessed by another process or the WAL checkpoint is blocked.

**Fix**:

```bash
# Check if another process has the DB open
lsof /root/voicenotebot/streaming-dictation/backend/data/transcripts.db

# Restart the service to release locks
systemctl restart streaming-dictation
```

The database uses WAL mode which handles concurrent reads well, but writes are still serialized. Under normal single-user usage, this should not be an issue.

---

## Service Won't Start

**Symptom**: `systemctl status streaming-dictation` shows failed/inactive.

**Check**:

```bash
# View detailed error
journalctl -u streaming-dictation -n 50 --no-pager

# Check if .env exists
ls -la /root/voicenotebot/streaming-dictation/backend/.env

# Check if dist/ exists (did build run?)
ls -la /root/voicenotebot/streaming-dictation/backend/dist/index.js

# Check Node.js version (needs 20+)
node --version

# Try running manually
cd /root/voicenotebot/streaming-dictation/backend
node dist/index.js
```

---

## Port Already in Use

**Symptom**: `EADDRINUSE` error on startup.

```bash
# Find process using port 3100
lsof -i :3100

# Kill it
kill <PID>

# Or change port in .env
PORT=3101
```
