# Streaming Dictation Frontend

React + Vite + TypeScript frontend for the Streaming Dictation web app.

This is the user-facing PWA shell for:
- login
- recording
- transcript history
- search
- settings
- copy-ready transcript viewing

For architecture and operations, see:
- [`../../docs/STREAMING-DICTATION/README.md`](../../docs/STREAMING-DICTATION/README.md)
- [`../../docs/STREAMING-DICTATION/FRONTEND.md`](../../docs/STREAMING-DICTATION/FRONTEND.md)
- [`../../docs/STREAMING-DICTATION/OPERATIONS.md`](../../docs/STREAMING-DICTATION/OPERATIONS.md)

## Stack

- React 18
- Vite
- TypeScript
- Tailwind CSS
- React Router
- Zustand
- vite-plugin-pwa
- Vitest + Testing Library

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

## Main App Pages

| Route | Purpose |
|---|---|
| `/login` | Password login |
| `/` | Record page |
| `/history` | Transcript history |
| `/search` | Transcript search |
| `/settings` | Cleanup model and retention settings |

## Runtime Notes

- The frontend depends on the backend for all auth and transcript APIs.
- In development, Vite proxies `/auth`, `/api`, and `/health` to the backend.
- In production, the backend serves the built frontend bundle from `dist/`.
- History refresh is visibility-aware and freshness-first.
- The app is installable as a PWA, but it is **not** an offline dictation app.

## Key Source Paths

```text
src/
  api/client.ts          API client
  components/            shared UI pieces
  hooks/                 frontend hooks (including visibility polling)
  pages/                 route screens
  store/                 Zustand state
  tests/                 frontend test suite
```

## Browser/Device Requirements

- microphone support via `getUserMedia`
- recording support via `MediaRecorder`
- HTTPS or localhost for microphone access on real devices

## Test / Build Status

Current verified checks from the repo root work include:
- `npm test` ✅
- `npm run typecheck` ✅
- `npm run build` ✅
