# Streaming Dictation Plan

Status: planning only, no implementation yet.

Project location: `/root/voicenotebot`

Legacy system to keep working as backup: existing Telegram voice note bot in this repo.

New system to add side-by-side: `streaming-dictation`

---

## 1. Purpose

Build a new single-user, phone-first, PWA-based streaming dictation system in this repo, alongside the existing Telegram voice note bot.

The new system should:

- use **OpenAI `gpt-4o-mini-transcribe`** as the primary STT path
- support **streaming capture** from a mobile-friendly PWA
- produce a **single final transcript** per recording, not live partial transcript in v1
- support **switchable cleanup models**:
  - **Kimi** using the exact existing API contract semantics
  - **OpenAI cleanup alternative**: plan assumes `gpt-5-nano` as the primary cost-effective comparison model, with implementation structured so `gpt-4o-mini` could be swapped in later if needed
- store **recent transcript history only** with a default retention of **14 days**
- provide **responsive web UI** usable on phone and desktop/laptop browsers
- provide **simple text search** over recent transcript history in v1
- provide **copy buttons** per transcript item on both mobile and desktop views
- use **simple robust single-user auth** with session-based login
- be deployable on this same server and reachable behind **Caddy**
- run as a **persistent service** that survives reboots/crashes
- keep the legacy Telegram bot operational as a fallback path

This plan is written for fresh-context coding agents and should be executable without relying on hidden context.

---

## 2. Product scope for v1

### Included

- PWA-first responsive web app
- Mobile recording screen with **tap-to-toggle** recording
- Desktop/laptop history/search/copy interface
- Shared synced transcript history between mobile and desktop
- OpenAI streaming STT primary path
- STT fallback to OpenAI batch rescue path using the captured audio blob if streaming fails
- Cleanup model selection in settings (global default)
- Two cleanup options only in v1:
  - Kimi
  - OpenAI `gpt-5-nano`
- Immediate final transcript output
- Search over recent transcripts
- 14-day retention policy
- Session auth
- Ops docs / deployment docs / restart docs / troubleshooting docs
- Test coverage for new modules

### Explicitly excluded from v1

- Native mobile app
- Telegram as primary workflow for the new app
- Discord as a primary workflow
- Multi-user support
- Semantic search
- Tags / folders / notebooks
- Push to external systems (Telegram, Notion, Google Docs, email)
- Live partial transcript while speaking
- Shared code reuse with legacy Telegram bot implementation

---

## 3. Key decisions already made

These are fixed inputs for implementation unless the user changes them later.

- **Frontend shape**: responsive **PWA-first** web app
- **Recording UX**: **tap to start / tap to stop**
- **Transcript UX**: final transcript appears as one item after processing
- **History UX**: separate transcript items with copy button; timestamp + preview
- **Mobile + desktop**: one responsive web app, not separate apps
- **Sync**: mobile and desktop use the same transcript history
- **Cleanup selection UX**: global default in settings
- **Cleanup models**: Kimi and one cost-effective OpenAI alternative; current preferred alternative = `gpt-5-nano`
- **STT primary**: OpenAI `gpt-4o-mini-transcribe`
- **STT fallback**: OpenAI batch rescue path using captured audio blob
- **Auth**: simple robust **session-based login**
- **Retention**: keep only recent history, default 14 days
- **Search**: simple text search in v1
- **Ownership model**: single-user system
- **Repo relationship**: same repo, mostly separate services
- **Legacy bot**: must keep working as backup
- **Code sharing**: do not reuse implementation code between new app and legacy bot; replicate external API behaviour where needed, especially for Kimi
- **Docs**: shared docs for repo-level overview + separate docs for service-specific operation

---

## 4. Repo structure target

Add a new subtree without disturbing the legacy bot runtime path.

Recommended target structure:

```text
/root/voicenotebot/
  README.md
  STREAMING-DICTATION-PLAN.md
  docs/
    OVERVIEW.md
    TROUBLESHOOTING.md
    DEPLOYMENT.md
    LEGACY-TELEGRAM-BOT.md
    STREAMING-DICTATION/
      README.md
      ARCHITECTURE.md
      API.md
      FRONTEND.md
      BACKEND.md
      AUTH.md
      OPERATIONS.md
      TESTING.md
      TROUBLESHOOTING.md
  streaming-dictation/
    frontend/
    backend/
    shared-types/            # optional; only for new app internals
    tests/
    scripts/
    systemd/
    .env.example
    package.json / lockfiles / workspace files as chosen
  webhook/
  worker/
  shared/
  tests/
```

Notes:

- New app should be operationally separate from `webhook/`, `worker/`, and legacy `shared/`.
- Shared repo-level docs should explain both systems and backup role.
- New app may have its own internal shared types, but should not depend on legacy bot Python modules.

---

## 5. Recommended technology direction

This plan intentionally separates frontend and backend work so different agents can execute in parallel.

### Frontend recommendation

Use a modern TypeScript SPA/PWA stack optimized for mobile responsiveness.

Preferred:
- React + Vite + TypeScript
- PWA support via Vite PWA plugin or equivalent
- Simple state management (Zustand or React Query + local state)
- Responsive layout with a utility CSS system (Tailwind or equivalent)

### Backend recommendation

Use a web backend that can:
- serve authenticated API endpoints
- support streaming audio ingestion
- manage transcript storage and retention
- call OpenAI and Kimi APIs
- expose health endpoints

Preferred backend direction:
- Node.js + TypeScript (to align well with frontend and OpenAI realtime/websocket flows)
- Express/Fastify/Hono acceptable; pick one and keep it simple
- SQLite for v1 is acceptable if operational simplicity is highest priority
- Postgres acceptable if there is already infrastructure preference, but SQLite likely keeps v1 simpler on a single-user server

### Persistence/service recommendation

- Run backend as a **systemd** service for persistence across reboot/crash
- Frontend should be built to static assets and either:
  - served by backend, or
  - served by a small frontend preview/static process also managed by systemd

Preferred simplicity path:
- Backend serves API + built frontend assets from one process
- Caddy reverse proxies to that backend service

---

## 6. High-level architecture

```text
Phone / Desktop Browser (same responsive PWA)
  -> Authenticated web app
  -> Start/stop audio capture
  -> Stream audio to backend

Backend
  -> Session auth
  -> Streaming audio ingest
  -> OpenAI STT primary (`gpt-4o-mini-transcribe`)
  -> Fallback batch STT rescue on stream failure
  -> Cleanup step:
       - Kimi (exact legacy-compatible contract semantics)
       - OpenAI `gpt-5-nano`
  -> Store transcript item
  -> Search / list / copy-ready payloads
  -> Retention cleanup job

Ops
  -> systemd-managed service(s)
  -> Caddy reverse proxy in front
  -> docs for start/stop/restart/logs/troubleshooting
```

---

## 7. Functional requirements

### 7.1 Auth

- Single-user login page
- Session cookie auth
- Simple but robust implementation
- Must protect both mobile and desktop interfaces
- Session TTL suitable for daily use; avoid forcing constant re-login
- Logout support
- Auth docs must clearly describe env vars and secret rotation

### 7.2 Recording

- Tap once to start recording
- Tap once to stop recording
- Visible recording state
- Clear error state if microphone permission missing
- Mobile-friendly controls sized for safe tapping
- No requirement for live partial transcript in v1

### 7.3 Transcript output

- One final cleaned transcript per recording
- Transcript item includes:
  - ID
  - created timestamp
  - preview text
  - full cleaned text
  - search visibility
  - cleanup model used
  - STT mode used / fallback flag
- Copy button on each item on mobile and desktop
- Item detail view optional if list card can expand inline cleanly

### 7.4 Search/history

- Default retention: 14 days
- Simple text search over transcript text and preview
- Sorted newest first
- Efficient enough for recent-history-only use

### 7.5 Cleanup settings

- Settings page includes global default cleanup model
- Exactly two cleanup options in v1:
  - Kimi
  - OpenAI `gpt-5-nano`
- Cleanup may be disabled in future, but not required in v1 unless implementer finds this nearly free

### 7.6 STT fallback

- Primary: streaming STT path
- If streaming finalisation fails, use captured audio blob to perform batch rescue transcription via OpenAI
- UI should still present final transcript if fallback succeeds
- History item should record whether fallback path was used

---

## 8. API and backend module plan

Backend should be modularized so agents can work independently.

Recommended backend modules:

1. **auth**
   - login
   - logout
   - session creation/validation
   - auth middleware

2. **config**
   - env loading
   - model IDs
   - retention settings
   - auth secrets

3. **audio ingest**
   - streaming upload/session handling
   - audio chunk assembly / buffering
   - final blob persistence until transcript completes

4. **stt**
   - OpenAI primary streaming STT client
   - OpenAI batch fallback STT client
   - timing + error instrumentation

5. **cleanup**
   - Kimi client with exact contract semantics
   - OpenAI cleanup client using `gpt-5-nano`
   - model selection abstraction

6. **transcripts**
   - create/list/get/search/delete-expired
   - retention policy

7. **health/observability**
   - health endpoint
   - readiness info
   - structured logging

8. **frontend asset serving**
   - serve built SPA assets from backend process, if using single-process deploy

### Recommended API surface (indicative)

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/session`
- `POST /api/recordings/start` (optional if backend session init is needed)
- `POST /api/recordings/stream` or websocket endpoint
- `POST /api/recordings/finish`
- `GET /api/transcripts`
- `GET /api/transcripts/search?q=...`
- `GET /api/transcripts/:id`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /health`

Implementation may choose websocket/SSE differently, but the resulting API docs must be explicit.

---

## 9. Kimi compatibility requirements

The new app must not import legacy bot code, but its Kimi integration must faithfully replicate the effective external contract semantics used by the current bot.

Implementation requirements:

- Use the **same endpoint family** currently used by the legacy bot
- Use the **same model ID** currently used by the legacy bot
- Use the **same HTTP header behaviour** currently required by Kimi
- Preserve cleanup prompt intent from the current bot unless the user explicitly changes it later
- Document all Kimi-specific assumptions in the new app docs

Before implementation, agent should inspect current bot Kimi client carefully and capture in docs:
- endpoint
- headers
- payload structure
- timeout
- model ID
- error handling expectations

This should be documented in `docs/STREAMING-DICTATION/BACKEND.md` or `API.md`.

---

## 10. Cleanup model recommendation and comparison note

### v1 recommended alternative model

Use **OpenAI `gpt-5-nano`** as the non-Kimi cleanup option.

Reasoning:
- lower token cost than `gpt-4o-mini`
- likely sufficient for narrow cleanup task
- simpler operational path than introducing OpenRouter in v1
- easier debugging because STT is already OpenAI-based

### Important implementation note

Structure cleanup model abstraction so later swapping to `gpt-4o-mini` is trivial if `gpt-5-nano` proves too weak or stylistically odd for cleanup.

### OpenRouter note

Do not make OpenRouter a v1 cleanup requirement. It may be documented as a future option only.

---

## 11. Frontend module plan

Recommended frontend modules:

1. **auth pages**
   - login form
   - session restore / redirect

2. **recording screen**
   - microphone permission handling
   - start/stop tap button
   - visible states: idle, recording, processing, error
   - cleanup model indicator

3. **history list**
   - recent transcript cards
   - timestamp + preview
   - copy button
   - mobile and desktop responsive layout

4. **search UI**
   - simple search input
   - debounced query
   - filtered recent history

5. **settings UI**
   - choose cleanup model
   - retention display (may be read-only in v1)

6. **PWA support**
   - installability
   - app manifest
   - service worker strategy appropriate for simple authenticated app

### Frontend usability requirements

- Works well on narrow mobile viewport
- Works well on desktop browser for search/copy flow
- Copy button should provide clear success feedback
- History items should be easy to tap on mobile
- Avoid overdesigned UI; prefer simple, pleasant, mobile-friendly design

---

## 12. Data model plan

Suggested transcript entity:

```text
Transcript
- id
- created_at
- expires_at
- preview_text
- raw_text                # optional but recommended for debugging / comparison
- cleaned_text
- cleanup_model           # kimi | gpt-5-nano
- stt_model               # gpt-4o-mini-transcribe
- used_fallback           # boolean
- duration_ms             # optional
- status                  # completed | failed
```

Suggested settings entity (single-user):

```text
UserSettings
- id
- default_cleanup_model
- retention_days
```

Suggested auth/session storage:
- simple sessions table or signed-cookie session approach
- choose the simplest secure path supported by chosen backend stack

---

## 13. Retention and cleanup job plan

Retention must be automatic.

Requirements:
- default transcript retention = 14 days
- expired transcripts removed automatically
- job should run safely without manual intervention

Implementation options:
- scheduled cleanup inside backend process
- or separate lightweight cron/systemd timer

Preferred simplicity path:
- use a **systemd timer** or a simple scheduled cleanup routine documented clearly

Plan should document:
- when cleanup runs
- what it deletes
- how to trigger manually
- how to inspect logs

---

## 14. Service/runtime plan

The new streaming-dictation app must be persistent across reboot/crash.

### Recommended runtime strategy

Use **systemd** for the new service.

Preferred deploy shape:
- one backend process serving API + static frontend build
- one systemd service, e.g. `streaming-dictation.service`
- optional separate timer/service for retention cleanup if not embedded in backend

### Required systemd deliverables

Inside `streaming-dictation/systemd/` include templates or concrete examples for:
- `streaming-dictation.service`
- optional `streaming-dictation-retention.timer`
- optional `streaming-dictation-retention.service`

### Ops requirements

Docs must include:
- install steps
- enable/start commands
- restart commands
- status commands
- log inspection via `journalctl`
- common failure recovery steps

Caddy itself does not need to be planned in detail, but the plan must specify:
- expected local port
- that the app is reverse proxied through Caddy
- any websocket/SSE requirements if used by streaming transport

---

## 15. Docs plan

Documentation work is a first-class deliverable, not an afterthought.

### Shared repo docs to update

1. **Root README.md**
   - explain repo now contains two systems:
     - legacy Telegram bot
     - new streaming dictation app
   - explain Telegram bot remains backup
   - link to both doc sets

2. **Shared deployment/overview docs**
   - high-level comparison of both services
   - which ports/services/process managers they use
   - where logs live

3. **Shared troubleshooting doc**
   - repo-level quick paths to diagnose either system

### New app dedicated docs

Create at least:

- `docs/STREAMING-DICTATION/README.md`
- `docs/STREAMING-DICTATION/ARCHITECTURE.md`
- `docs/STREAMING-DICTATION/API.md`
- `docs/STREAMING-DICTATION/FRONTEND.md`
- `docs/STREAMING-DICTATION/BACKEND.md`
- `docs/STREAMING-DICTATION/AUTH.md`
- `docs/STREAMING-DICTATION/OPERATIONS.md`
- `docs/STREAMING-DICTATION/TESTING.md`
- `docs/STREAMING-DICTATION/TROUBLESHOOTING.md`

### Required doc content

Include:
- env vars
- service names
- local dev commands
- production run commands
- restart/redeploy flow
- cleanup model semantics
- STT fallback behaviour
- retention policy
- microphone permission issues
- mobile browser limitations
- common auth failures
- what happens if OpenAI STT fails
- what happens if Kimi fails

---

## 16. Testing plan

Testing must be split by module so parallel agent execution is possible.

### 16.1 Backend tests

Required categories:

1. **auth tests**
   - valid login
   - invalid login
   - session cookie required for protected routes
   - logout invalidates session

2. **settings tests**
   - default cleanup model returned correctly
   - settings update persists

3. **transcript storage tests**
   - transcript create/list/search
   - retention expiration logic
   - ordering newest-first

4. **cleanup client tests**
   - Kimi request shape / headers / model selection
   - OpenAI cleanup request shape / model selection
   - failure handling and fallback semantics

5. **STT tests**
   - primary path success
   - streaming failure triggering batch rescue path
   - batch rescue success/failure handling

6. **API tests**
   - route protection
   - transcript list response shape
   - search correctness
   - health endpoint

7. **retention job tests**
   - expired transcript removed
   - active transcript retained

### 16.2 Frontend tests

Required categories:

1. **auth page tests**
   - login form behaviour
   - invalid login message

2. **recording UI tests**
   - tap-to-toggle state transitions
   - permission denied error rendering
   - processing state rendering

3. **history UI tests**
   - render transcript cards
   - copy button behaviour
   - timestamp + preview rendering

4. **search UI tests**
   - filtering results
   - empty state

5. **settings UI tests**
   - cleanup model selection
   - load/save settings

6. **responsive behaviour tests**
   - at least targeted UI tests or visual validation for mobile vs desktop layouts

### 16.3 Integration tests

Required end-to-end coverage for the new app:

- login -> record -> process -> history item appears -> copy works
- login on desktop -> see same item -> search -> copy
- cleanup model switch -> subsequent transcript uses new model
- streaming failure -> batch fallback -> transcript still appears with fallback flag

### 16.4 Legacy test suite updates

Agents must review existing test structure and ensure:
- current legacy Telegram bot tests still pass unchanged
- any shared root-level CI/test invocation is updated to include both systems
- test docs explain how to run:
  - legacy tests only
  - streaming-dictation tests only
  - all tests

### 16.5 Test tooling expectations

- Keep test tooling conventional for chosen stack
- If new app uses Node/TS, likely Vitest + Playwright or equivalent
- If integration testing local browser UI, include clear commands and fixture strategy

---

## 17. Edge cases to include in implementation and tests

### Auth / session
- expired session while using app
- invalid login credentials
- malformed session cookie

### Recording / browser
- microphone permission denied
- no microphone available
- mobile browser suspends/interrupts recording
- user navigates away mid-recording
- duplicate tap events causing double start/stop

### STT
- OpenAI streaming connection failure before any transcript
- OpenAI streaming returns incomplete finalisation
- OpenAI batch fallback fails after stream failure
- network timeout during STT

### Cleanup
- Kimi timeout
- Kimi returns malformed response
- OpenAI cleanup returns empty text
- cleanup slower than STT by several seconds
- cleaned text empty while raw transcript exists

### Data/history
- transcript save succeeds but UI refresh lags
- search with no matches
- retention deletes old items correctly
- copy button on long transcript
- preview truncation on mobile

### Deployment/ops
- systemd service restarts after crash
- missing env vars fail fast with clear logs
- backend starts but frontend assets missing
- reverse proxy websocket/SSE config mismatch if streaming transport requires it

---

## 18. Parallel execution plan

This section is for orchestration. It is intentionally modular.

### Phase 0 — discovery and alignment (serial)

Must happen first.

Tasks:
1. Inspect current repo layout and confirm no hidden constraints
2. Inspect existing Kimi bot implementation and record exact contract details
3. Choose backend stack and frontend stack concretely
4. Define exact env var names and service names
5. Define final folder layout

Deliverables:
- short architecture decision note in docs
- scaffold decision frozen before parallel execution begins

### Phase 1 — scaffolding (mostly serial, then parallel)

Tasks:
1. Create `streaming-dictation/` subtree
2. Create frontend scaffold
3. Create backend scaffold
4. Create docs skeleton
5. Create test skeletons

Dependencies:
- backend/frontend scaffolds depend on stack choice from Phase 0

### Phase 2 — backend core and frontend core (parallel)

#### Backend workstream A: auth + persistence + transcripts
- auth module
- session handling
- transcript store
- retention job
- search/list APIs

#### Backend workstream B: STT + cleanup integration
- OpenAI streaming STT primary path
- batch rescue fallback path
- Kimi cleanup integration
- OpenAI cleanup integration

#### Frontend workstream A: auth + shell + responsive app frame
- login page
- app shell
- navigation/state/session restore

#### Frontend workstream B: recording + history/search/settings
- recording screen
- history list
- search UI
- settings UI
- copy interactions

Dependencies:
- frontend can begin against mocked backend contracts
- backend API contracts should be stabilised early for coordination

### Phase 3 — integration (serial-ish with some overlap)

Tasks:
1. Wire frontend to real backend
2. Validate auth/session flow end-to-end
3. Validate recording and final transcript persistence
4. Validate cleanup model switching
5. Validate search/history/copy on desktop and mobile layouts

### Phase 4 — testing hardening (parallel by module)

Tasks:
- backend unit/integration tests
- frontend component tests
- end-to-end tests
- legacy regression test run

### Phase 5 — docs + ops (parallel once system shape is stable)

Tasks:
- root/shared doc updates
- streaming-dictation docs
- systemd unit files
- deployment/restart guides
- troubleshooting guides

### Phase 6 — final verification (serial)

Tasks:
1. run new app test suite
2. run legacy bot test suite
3. run full repo verification commands
4. verify docs accuracy against actual commands and service names
5. verify systemd instructions and restart flow

---

## 19. Git strategy for implementation agents

Do not use this plan to prescribe branches/worktrees. Those decisions are explicitly out of scope for this document.

Implementation agents should still follow a disciplined commit strategy:

### Commit principles
- small, reviewable commits
- one logical concern per commit where possible
- avoid mixing frontend, backend, docs, and ops in one giant commit unless necessary
- commit docs alongside code when the code changes public behaviour

### Suggested commit grouping
1. scaffold / repo structure
2. backend auth + persistence
3. backend STT + cleanup
4. frontend shell + auth
5. frontend recording/history/search/settings
6. integration wiring
7. tests
8. ops/systemd
9. docs

### Commit message style
Use clear prefixes, e.g.:
- `feat(streaming-dictation-backend): ...`
- `feat(streaming-dictation-frontend): ...`
- `test(streaming-dictation): ...`
- `docs(streaming-dictation): ...`
- `ops(streaming-dictation): ...`

### Verification before final integration merge
Before final handoff, agents should review:
- `git status --short`
- `git diff --stat`
- relevant test outputs
- docs changed vs implemented behaviour

---

## 20. Suggested implementation order for fresh agents

If multiple agents are used, assign as follows:

### Agent 1 — architecture/scaffold coordinator
- Phase 0 + Phase 1
- API contract notes
- Kimi contract capture
- docs skeleton

### Agent 2 — backend auth/data
- auth
- session handling
- transcript store
- retention/search/list
- backend tests for these modules

### Agent 3 — backend STT/cleanup
- OpenAI streaming STT
- batch fallback
- Kimi integration
- OpenAI cleanup integration
- backend tests for these modules

### Agent 4 — frontend shell/auth/history
- app shell
- login
- history list
- search
- copy UX
- responsive layout

### Agent 5 — frontend recording/settings/integration
- recording screen
- settings page
- API wiring
- processing/error states
- frontend tests

### Agent 6 — ops/docs/test integration
- systemd units
- deployment docs
- troubleshooting docs
- end-to-end verification
- root README updates
- legacy/new system comparison docs

---

## 21. Verification checklist for completion

The plan should only be considered executed successfully when all of the following are true:

### Product checks
- can log in on phone browser
- can start/stop recording via tap toggle
- can receive final transcript as one item
- transcript appears in history with timestamp + preview + copy button
- can log in on desktop browser and see same history
- can search recent transcript history
- cleanup model can be changed in settings

### Reliability checks
- OpenAI primary STT works
- batch rescue fallback works if primary stream fails
- Kimi cleanup works with exact intended contract semantics
- OpenAI cleanup works with configured alternative model
- system survives backend restart
- system restarts on reboot/crash via systemd

### Legacy safety checks
- legacy Telegram voice note bot still runs
- legacy tests still pass
- repo docs clearly explain which service is primary vs backup

### Documentation checks
- deployment docs tested
- restart docs tested
- troubleshooting docs grounded in actual failure modes
- env vars documented accurately

---

## 22. Open questions intentionally deferred beyond planning

These should not block v1 planning unless implementers discover hard constraints:

- whether backend uses websocket vs chunked HTTP vs SSE combination for audio streaming control
- whether SQLite is sufficient or Postgres is preferred by implementer
- exact session library/framework choice
- whether raw transcript should be shown in UI or stored only for debugging
- whether cleanup-off mode is worth exposing in v1
- whether `gpt-5-nano` quality is fully sufficient vs switching to `gpt-4o-mini`

Implementation agents should document final decisions when they resolve them.

---

## 23. Final planning note

This plan deliberately favours:
- operational simplicity
- cost control
- single-user focus
- separation from the legacy Telegram bot
- enough modularity for parallel execution

It does **not** aim to recreate full OpenWhispr polish in v1. It aims to build the smallest reliable system that gives the user:
- phone-first streaming dictation
- synced browser history
- easy copy-paste
- cleanup model choice
- legacy Telegram fallback

That should remain the north star during implementation.
