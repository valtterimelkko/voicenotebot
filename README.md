# VoiceNote Bot

VoiceNote Bot is a self-hosted dictation project built for people who work with AI on the move.

It contains two related systems:

1. **Streaming Dictation** — the current browser-based PWA for fast dictation across phone and laptop
2. **Legacy Telegram Bot** — the original queue-based voice-note transcription bot, still kept as a useful fallback path

## Why this exists

This project started from a very practical need: dictating to AI coding agents and LLMs is often much faster than typing.

I found myself doing more and more voice-driven work, but I did not want to depend entirely on paid dictation services. I also wanted something that fit a different working pattern from desktop-only tools: I move around a lot, I often interact with agents from my phone, and I wanted a dictation workflow that worked well in a mobile browser as well as on a laptop.

That is what led to VoiceNote Bot.

The first version was the **Telegram bot**. It solved the basic problem well: send a voice note, let a queue-backed service transcribe it, clean it up, and send text back. That version is still useful, especially when absolute speed is not the top priority and when a resilient asynchronous workflow is preferable.

The later version, **Streaming Dictation**, became the main product. It was inspired in part by [OpenWhispr](https://openwhispr.com/) / [openwhispr on GitHub](https://github.com/openwhispr/openwhispr), which deserves explicit credit here. That project helped demonstrate how much better dictation feels when audio starts moving through the system while you are still speaking rather than only after a full recording upload.

VoiceNote Bot takes that broader idea into a different use case:

- browser-first rather than desktop-app-first
- phone-friendly rather than single-machine-first
- self-hosted and easy to adapt
- useful for people who copy, review, and lightly edit text before sending it into AI tools

That last point matters. This is not trying to eliminate copy-paste at all costs. In practice, many AI workflows benefit from a short review/edit step before the text is sent onward.

## Who this is for

VoiceNote Bot is especially suited to people who:

- work with AI agents from both laptop and phone
- want a dictation workflow in the browser
- prefer self-hosting over subscriptions
- want a system they can fork and tune for their own language, cleanup rules, or prompting style
- value resilience across providers rather than depending on one vendor path

It may be less ideal for users who stay on one machine all day and want the tightest possible OS-level desktop insertion workflow. There are other excellent tools for that. This repo is strongest when portability and cross-device access matter.

## How the two systems differ

### Streaming Dictation

The browser app is the primary current product.

It is designed for lower-latency dictation by warming up the transcription path and streaming audio during the recording lifecycle. It also adds:

- login + session auth
- transcript history
- search
- settings
- retention controls
- PWA installability
- cleanup model selection

### Legacy Telegram Bot

The Telegram bot is the original architecture and remains valuable as a fallback.

It is naturally a little slower because the workflow is more batch-like: record, send, process, return. But it is still useful and robust.

It also reflects an important design choice in this repo: transcription and cleanup are treated as separate concerns. Audio is transcribed first, then a cleanup model improves the text. In the legacy path, OpenRouter is used for cleanup partly to keep provider flexibility if one upstream path is unavailable.

## Language and cleanup

Both systems use a transcription step and a cleanup step. The cleanup defaults are tuned around British English in the maintainer's own workflow, but this is exactly the kind of thing users should feel free to fork and customise.

## Architecture at a glance

```text
Streaming Dictation (primary)
  Browser PWA
    -> Express + TypeScript backend
    -> OpenAI transcription + cleanup model selection
    -> SQLite transcript store

Legacy Telegram Bot (fallback)
  Telegram
    -> FastAPI webhook
    -> Redis queue
    -> RQ workers
    -> Whisper/OpenAI transcription path
    -> OpenRouter cleanup
```

## Repository layout

```text
streaming-dictation/         Browser-based dictation app
  backend/                   Node + Express + SQLite backend
  frontend/                  React + Vite + TypeScript + PWA frontend
  scripts/                   Deploy helpers
  systemd/                   Example service unit

docs/STREAMING-DICTATION/    Streaming Dictation documentation

webhook/                     Legacy Telegram webhook service
worker/                      Legacy worker pipeline
shared/                      Shared Python utilities
tests/                       Legacy Python test suite
```

## Quick start

### Streaming Dictation

Backend:

```bash
cd streaming-dictation/backend
npm install
cp .env.example .env
npm run build
```

Frontend:

```bash
cd streaming-dictation/frontend
npm install
npm run build
```

### Legacy Telegram Bot

```bash
cp .env.example .env
docker compose up -d
```

See the documentation map below before treating these as production instructions; some operational docs remain tuned to the original self-hosted environment.

## Documentation map

- [`docs/STREAMING-DICTATION/README.md`](docs/STREAMING-DICTATION/README.md) — Streaming Dictation docs index
- [`docs/STREAMING-DICTATION/ARCHITECTURE.md`](docs/STREAMING-DICTATION/ARCHITECTURE.md) — app architecture
- [`docs/STREAMING-DICTATION/API.md`](docs/STREAMING-DICTATION/API.md) — backend API
- [`docs/STREAMING-DICTATION/AUTH.md`](docs/STREAMING-DICTATION/AUTH.md) — auth model
- [`docs/STREAMING-DICTATION/OPERATIONS.md`](docs/STREAMING-DICTATION/OPERATIONS.md) — deployment and service management
- [`docs/STREAMING-DICTATION/TESTING.md`](docs/STREAMING-DICTATION/TESTING.md) — checks and testing
- [`STREAMING-DICTATION-PLAN.md`](STREAMING-DICTATION-PLAN.md) — implementation history and plan
- [`RESEARCH-FINDINGS.md`](RESEARCH-FINDINGS.md) — architecture research
- [`docs/MAINTAINER-RUNBOOK.md`](docs/MAINTAINER-RUNBOOK.md) — maintainer-facing operational notes preserved from the original private README

## Notes for public users

This repository started as a personal, heavily used self-hosted tool. Some docs therefore contain environment-specific paths and operational assumptions. They are useful as reference material, but you should treat them as examples rather than mandatory architecture.

## License

MIT
