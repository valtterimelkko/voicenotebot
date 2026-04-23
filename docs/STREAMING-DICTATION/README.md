# Streaming Dictation

A single-user web application for browser-based voice dictation with automatic transcription and AI-powered text cleanup.

## System Overview

The streaming dictation app captures audio from the browser microphone in real-time, sends it to a Node.js backend for OpenAI transcription, then passes the raw text through an LLM cleanup stage (Kimi or GPT-5-nano) to produce polished transcripts with British spelling conventions.

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture and data flow |
| [API.md](./API.md) | Full REST API reference |
| [AUTH.md](./AUTH.md) | Authentication and session management |
| [OPERATIONS.md](./OPERATIONS.md) | Installation, deployment, and maintenance |
| [TESTING.md](./TESTING.md) | Running and writing tests |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common issues and fixes |

## Quick Links

- **Backend source**: `streaming-dictation/backend/src/`
- **Frontend source**: `streaming-dictation/frontend/`
- **Config**: `streaming-dictation/backend/.env`
- **Port**: 3100
- **Health check**: `GET /health`
