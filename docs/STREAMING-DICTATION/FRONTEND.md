# Frontend — Streaming Dictation

React + Vite + TypeScript + Tailwind CSS + PWA frontend for the streaming dictation system.

**Location:** `streaming-dictation/frontend/`

---

## Stack

| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| Vite | Build tool and dev server |
| TypeScript | Type safety |
| Tailwind CSS v3 | Utility-first styling |
| vite-plugin-pwa | PWA manifest + service worker |
| Zustand | Lightweight client state |
| React Router v6 | Client-side routing |
| Vitest + Testing Library | Unit tests |

---

## Dev Commands

```bash
cd streaming-dictation/frontend

# Install dependencies
npm install

# Start dev server (proxies /auth, /api, /health to localhost:3100)
npm run dev

# Build for production (output: dist/)
npm run build

# Type check only
npm run typecheck

# Run tests
npm test

# Preview production build
npm run preview
```

---

## Project Structure

```
src/
  api/client.ts          — typed API client for all backend endpoints
  store/
    authStore.ts         — Zustand auth state (authenticated | null | false)
    settingsStore.ts     — Zustand settings cache
  components/
    Layout.tsx           — top bar + bottom nav (mobile) / header nav (desktop)
    RecordButton.tsx     — animated 140px circular button with state machine
    TranscriptCard.tsx   — transcript item: meta, text, expand, copy button
    CopyButton.tsx       — clipboard copy with ✓ Copied feedback
    LoadingSpinner.tsx   — accessible spinner
  pages/
    LoginPage.tsx        — password form, error handling, session redirect
    RecordPage.tsx       — MediaRecorder, chunked streaming, state machine
    HistoryPage.tsx      — transcript list, empty state, refresh
    SearchPage.tsx       — debounced search input (400ms), result list
    SettingsPage.tsx     — cleanup model radio, retention display
  tests/
    setup.ts             — jest-dom setup
    LoginPage.test.tsx   — auth form behaviour tests
    components.test.tsx  — RecordButton, CopyButton unit tests
    pages.test.tsx       — HistoryPage, SearchPage, SettingsPage tests
  App.tsx                — router, session check, ProtectedRoute
  main.tsx               — React entry point
  index.css              — Tailwind directives
public/
  pwa-192x192.png        — PWA icon
  pwa-512x512.png        — PWA icon (maskable)
  apple-touch-icon.png   — iOS home screen icon
  favicon.ico            — browser tab icon
```

---

## Pages and Routes

| Route | Component | Auth required |
|---|---|---|
| `/login` | LoginPage | No |
| `/` | RecordPage | Yes |
| `/history` | HistoryPage | Yes |
| `/search` | SearchPage | Yes |
| `/settings` | SettingsPage | Yes |
| `*` | Redirect to `/` | — |

---

## Recording Flow

1. User taps the record button on `RecordPage`
2. Browser requests microphone permission via `getUserMedia({ audio: true })`
3. `POST /api/recordings/start` → gets `{ id }` from backend
4. `MediaRecorder` starts with 1-second `timeslice` intervals
5. Each `ondataavailable` chunk → `POST /api/recordings/:id/stream` (octet-stream)
6. User taps again to stop → `recorder.stop()` fires final chunk
7. All in-flight chunks drain via chained Promises
8. `POST /api/recordings/:id/finish` → backend runs STT + cleanup → returns `Transcript`
9. Transcript shown inline on RecordPage; also visible in History

### Audio MIME type selection

Preferred order:
1. `audio/webm;codecs=opus`
2. `audio/webm`
3. `audio/ogg;codecs=opus`
4. `audio/mp4`
5. Browser default (empty string)

---

## Recording State Machine

```
idle ──tap──► recording ──tap──► processing ──success──► idle
 ▲                                      │
 │                                      └──error──► error
 └──────────────────tap───────────────────────────────┘
```

States:
- `idle` — blue button, circular indicator
- `recording` — red button, pulsing square indicator
- `processing` — grey disabled button, spinning indicator
- `error` — orange button, error message below, tap to retry

---

## PWA Configuration

`vite-plugin-pwa` generates:
- `dist/manifest.webmanifest` — app name, icons, theme, display mode
- `dist/sw.js` — Workbox service worker
- `dist/workbox-*.js` — Workbox runtime

Service worker strategy:
- **Static assets** — precached
- `/api/*` — `NetworkOnly` (never serve stale API responses)
- Navigation fallback — `/index.html`

---

## Responsive Layout

### Mobile (< md breakpoint, 768px)
- Fixed bottom navigation bar (4 tabs: Record, History, Search, Settings)
- Logout button in top-right header
- Tap targets ≥ 44px (safe for thumb)
- Full-width content with `px-4` side padding

### Desktop (≥ md breakpoint)
- Horizontal nav links in the top header bar
- Content area with `max-w-2xl mx-auto` container
- No bottom nav bar

---

## API Wiring

All requests go through `src/api/client.ts`:
- Credentials: `include` on every fetch (session cookie)
- Error handling: non-2xx → throws `Error` with backend `error` message
- Chunk streaming: raw `fetch` with `application/octet-stream` body

Vite dev proxy maps:
```
/auth  → http://localhost:3100
/api   → http://localhost:3100
/health → http://localhost:3100
```

In production, the backend at port 3100 serves both API and the built static assets.

---

## Session Handling

On app load, `App.tsx` calls `GET /auth/session`:
- `{ authenticated: true }` → show protected routes
- `{ authenticated: false }` → redirect to `/login`
- Network error → treat as unauthenticated

`ProtectedRoute` shows a loading spinner while session check is pending (prevents flash-of-login).

After successful login, `useAuthStore.authenticated` is set to `true` in Zustand and user is navigated to `/`.

---

## Microphone Error Handling

| Browser error | User message |
|---|---|
| `NotAllowedError` / `PermissionDenied` | "Microphone permission denied. Please allow microphone access in your browser settings and try again." |
| `NotFoundError` / `device not found` | "No microphone found. Please connect a microphone and try again." |
| `getUserMedia` not available | "Your browser does not support microphone access. Please use a modern browser." |
| Other | `"Microphone error: <message>"` |

---

## Testing

```bash
npm test           # run all tests once
npm run test:watch # watch mode
```

23 tests across 3 files:
- `LoginPage.test.tsx` — form render, disabled state, login error, API call
- `components.test.tsx` — RecordButton states, CopyButton clipboard feedback
- `pages.test.tsx` — HistoryPage load/empty/fallback badge, SearchPage, SettingsPage

All tests mock the `api` module via `vi.mock('../api/client')`.

---

## Build for Production

```bash
npm run build
# Output: streaming-dictation/frontend/dist/
```

The backend (`streaming-dictation/backend/src/index.ts`) serves `dist/` as static files:
```ts
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist')
app.use(express.static(frontendDist))
app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')))
```

So the full app is accessible at `http://localhost:3100` (or via Caddy reverse proxy).

---

## Mobile Browser Notes

- Tested MIME type detection for Safari (prefers `audio/mp4`) and Chrome/Firefox (prefers `audio/webm;codecs=opus`)
- `touch-manipulation` CSS applied to record button to eliminate 300ms tap delay
- `min-h-[100dvh]` used instead of `100vh` to handle mobile browser chrome correctly
- `safe-bottom` class reserved for iOS safe area insets on bottom nav
