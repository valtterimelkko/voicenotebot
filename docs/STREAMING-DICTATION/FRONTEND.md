# Frontend — Streaming Dictation

React + Vite + TypeScript + Tailwind + PWA frontend for the Streaming Dictation app.

**Location:** `streaming-dictation/frontend/`

## What This Layer Owns

The frontend owns the browser-side user flow for:
- login
- microphone capture
- chunk upload during recording
- transcript display and copy actions
- transcript history and search
- settings editing
- responsive navigation for mobile and desktop

For repo-wide context, start with [`README.md`](../../README.md) and [`README.md`](./README.md).

## Stack

| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| Vite | Build tool and dev server |
| TypeScript | Type safety |
| Tailwind CSS v3 | Styling |
| vite-plugin-pwa | PWA manifest + service worker |
| Zustand | Lightweight state |
| React Router v6 | Client-side routing |
| Vitest + Testing Library | Frontend tests |

## Development Commands

```bash
cd /root/voicenotebot/streaming-dictation/frontend
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm run preview
```

## Main Routes

| Route | Component | Auth required |
|---|---|---|
| `/login` | LoginPage | No |
| `/` | RecordPage | Yes |
| `/history` | HistoryPage | Yes |
| `/search` | SearchPage | Yes |
| `/settings` | SettingsPage | Yes |

## Recording Flow

1. User taps the record button.
2. Frontend requests microphone access with `getUserMedia`.
3. Frontend creates a recording on the backend with `POST /api/recordings/start`.
4. `MediaRecorder` emits chunks at intervals.
5. Each chunk is sent to `POST /api/recordings/:id/stream`.
6. User stops recording.
7. Frontend waits for in-flight uploads to drain.
8. Frontend calls `POST /api/recordings/:id/finish`.
9. Returned transcript is shown immediately and later appears in history/search.

## Freshness / Polling Behaviour

Recent frontend behaviour that matters operationally:
- history polling is **visibility-aware**
- hidden tabs stop polling
- returning to the tab triggers a refresh
- history fetches are freshness-first rather than cache-first

This behaviour exists to avoid stale transcript history and unnecessary background work.

## PWA Behaviour

The frontend is an installable PWA shell with precached static assets.

Important caveat:
- it should be treated as an **installable network app**, not an offline dictation app
- API traffic is intentionally network-first / no-store
- recording still depends on backend reachability

## Responsive UX

### Mobile
- bottom navigation
- large tap targets
- phone-first record workflow

### Desktop
- header navigation
- wider reading layout for transcript history/search

## Key Source Layout

```text
src/
  api/client.ts
  components/
  hooks/
  pages/
  store/
  tests/
```

## Browser Constraints

- microphone access requires HTTPS or localhost
- `getUserMedia` and `MediaRecorder` support are required
- some mobile browser limitations still apply, especially around backgrounding and screen lock

## Current Verification Notes

Current checked status:
- frontend tests pass
- frontend typecheck passes
- frontend build passes
