# VoiceNote Bot Architecture Research: Comprehensive Findings

## Your Current Situation (Summary)

**Current Architecture Bottlenecks Identified:**

1. **File-based transcription pipeline**: Your bot waits for the entire voice note to be recorded → uploaded to Telegram → downloaded by the bot → converted via ffmpeg → uploaded to OpenAI → transcribed. The transcription doesn't start until the entire audio file is ready.

2. **Sequential Kimi cleanup**: After OpenAI transcription (which is fast), the full text is sent to Kimi API with a 300s timeout and 60K max_tokens. For a 30-60 second dictation, this second LLM call often takes longer than the transcription itself.

3. **Queue + worker overhead**: RQ adds queuing latency, and with only 2 workers, messages can stack up behind each other.

4. **ffmpeg conversion overhead**: Every Telegram `.oga` file gets converted to `.wav` via ffmpeg before OpenAI.

**Pipeline latency breakdown (current)**:
| Stage | Time |
|-------|------|
| Telegram upload | 0.5-3s |
| Webhook delivery | ~0.1s |
| File download | 0.5-2s |
| ffmpeg conversion | 0.1-0.3s |
| OpenAI transcription | 0.3-1s |
| Kimi cleanup | 1-5s (often the longest!) |
| Send response | 0.1s |
| **Total** | **3-12 seconds** |

---

## Research Findings by Topic

### 1. OpenAI Realtime API (Streaming)

**Can it help you? Partially, but with tradeoffs.**

The OpenAI Realtime API offers **true streaming** via WebRTC with sub-300ms latency and incremental transcription (words appear as you speak). However:

| Factor | Realtime API | Your Current (File API) |
|--------|--------------|-------------------------|
| **Cost** | ~$0.03-0.06/min | $0.003/min (10x cheaper!) |
| **Latency feel** | Words appear as you speak | Wait for entire file |
| **End-to-end** | ~1.1-1.5s | ~0.3-0.5s for short clips |
| **Mobile battery** | Higher (persistent connection) | Lower (HTTP requests) |
| **Bot context** | ❌ Poor fit | ✅ Works well |
| **Complexity** | High (WebRTC) | Low (HTTP) |

**Verdict**: The Realtime API is designed for interactive conversations (like ChatGPT Voice), not for a Telegram bot webhook architecture. It requires a persistent WebRTC connection which doesn't fit well with your current RQ-worker batch processing model.

---

### 2. Telegram Bot API Limitations

**Key Finding: Telegram Bot API does NOT support streaming voice.**

- Voice messages are **file-based only** (.oga OGG/OPUS format)
- The entire voice note must be recorded and uploaded before your bot receives it
- **Theoretical minimum latency for Telegram bot**: ~2-4 seconds (with optimizations)

**Could Telegram Mini Apps enable streaming?**

**Partially yes**, but with a completely different architecture:
- Mini Apps (Web Apps) can access microphone via WebRTC/getUserMedia
- They can stream audio to your own server in real-time
- But they **bypass Telegram's voice message system entirely** — users won't use the familiar voice message UI
- Permission issues on Android (must re-grant mic access each session)

```
┌─────────────────┐     WebRTC Stream      ┌──────────────────┐
│ Telegram Mini   │ ─────────────────────►│ Your Server      │
│ App (iframe)    │    Real-time audio    │ - OpenAI RT API  │
│ - getUserMedia  │                        │ - Local Whisper  │
│ - WebRTC        │                        │ - Streaming STT  │
└─────────────────┘                        └────────┬─────────┘
       ▲                                            │
       └──────── Text via Bot API ◄─────────────────┘
```

**Verdict**: For a native Telegram voice experience, you're stuck with file-based processing. Mini Apps require a completely different UX (users open an app instead of sending a voice message).

---

### 3. Discord Voice & Alternative Platforms

**Discord bots CAN do real-time voice streaming**, but:
- Must join a voice channel (awkward for mobile dictation)
- High technical complexity
- Poor mobile UX compared to Telegram's native voice messages
- Libraries: `@discordjs/voice` (production), `discord-ext-voice-recv` (Python, experimental)

| Platform | Streaming | Mobile UX | Complexity | Recommendation |
|----------|-----------|-----------|------------|----------------|
| **Telegram** | ❌ File-only | ✅ Excellent | Low | Keep using |
| **Discord** | ✅ Yes | ❌ Poor | High | Not recommended |
| **Web Speech API** | ✅ Yes | ✅ Excellent | None | Chrome only |
| **Whisper Web** | ✅ Local | ✅ Good | None | WebGPU required |

**Verdict**: Discord is not a better option for your use case. Stick with Telegram for mobile voice UX.

---

### 4. Mobile Apps with BYOK (Bring Your Own Key)

**iOS Options:**

| App | BYOK | Cost | Latency | Notes |
|-----|------|------|---------|-------|
| **WhisperDirect** | ✅ OpenAI | $3.99 one-time + API | Batch | Best iOS BYOK option; Google Drive sync |
| **OpenWhispr** | ✅ Multi | Free / $6.67mo Pro | Fast | "Mobile coming soon" for 6+ months |
| **Whisper Web** | ❌ Local | Free / $10mo Unlimited | Streaming | WebGPU in Safari; no API key needed |

**Android Options:**

| App | BYOK | Cost | Latency | Notes |
|-----|------|------|---------|-------|
| **Phone Whisper** | ✅ OpenAI | Free (open source) | PTT | Floating overlay; local models too |
| **Whispering Web** | ✅ Multi | Free | Fast | Browser-based; works on Android |

**Desktop (for reference):**

| App | BYOK | Cost | Sync |
|-----|------|------|------|
| **OpenWhispr** | ✅ Multi | Free / $6.67mo Pro | ✅ Pro only |
| **Whispering** | ✅ Multi | Free | ❌ Clipboard only |
| **TalkCopyPaste** | ✅ Multi | $29 one-time | ❌ |
| **PasteVoice** | ✅ Yes | $49-149 one-time | ❌ |

**Key Finding**: For your phone-to-web workflow, **WhisperDirect (iOS)** or **Phone Whisper (Android)** + cloud backup could replace your bot. But you'd lose the copy-paste workflow unless you use Google Drive sync.

---

### 5. Self-Hosted Pop!_OS Architecture (Most Promising!)

Since you have a Pop!_OS desktop with GPU at home, this is a **viable path**:

#### Architecture: Tailscale + Local Whisper + n8n Sync

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Your Pop!_OS Desktop (Home)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Tailscale    │  │ Whisper-Live │  │ n8n Workflow Engine      │  │
│  │ (WireGuard)  │◄─┤ (WebSocket   │◄─┤ - Webhook trigger        │  │
│  │              │  │  + REST API) │  │ - Send to Telegram       │  │
│  └──────┬───────┘  └──────────────┘  │ - Push to Google Doc     │  │
│         │                             └──────────────────────────┘  │
└─────────┼───────────────────────────────────────────────────────────┘
          │ Tailscale P2P (30-80ms)
┌─────────▼───────────────────────────────────────────────────────────┐
│                           Your Phone                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Tailscale    │  │ Diction (iOS)│  │ Web Browser (PWA)        │  │
│  │ Client       │◄─┤ or Browser   │  │ - Web Audio API          │  │
│  │              │  │              │  │ - Stream to Whisper      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Work Laptop (Office)                        │
│  - Access same Tailscale network                                     │
│  - Or receive transcriptions via Telegram/Docs                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Components:

1. **Tailscale** (free for personal use)
   - Zero-config VPN connecting phone ↔ home desktop
   - Direct P2P connections (30-80ms latency over 4G/5G)
   - No port forwarding, no dynamic DNS

2. **docker-whisper-live** (self-hosted)
   - WebSocket streaming for real-time transcription
   - OpenAI-compatible REST API
   - `large-v3-turbo` model on your GPU
   - **Latency**: 0.2-0.8s for transcription (20-50x real-time factor)

3. **n8n** (workflow automation)
   - Receive transcription webhooks
   - Forward to Telegram bot, Google Docs, Notion, etc.

#### Latency Estimate (Home Server):

| Component | Time |
|-----------|------|
| Network (5G → Home via Tailscale) | 30-80ms |
| Audio streaming (1s chunks) | ~16KB transfer |
| Whisper processing (large-v3-turbo GPU) | 0.2-0.5s |
| n8n webhook processing | ~0.1s |
| **Total** | **~0.5-1.5 seconds** |

This is **significantly faster** than your current 3-12 second pipeline!

#### Docker Compose Stack:

```yaml
version: "3.9"
services:
  whisper-live:
    image: hwdsl2/whisper-live-server
    ports:
      - "127.0.0.1:9090:9090"  # WebSocket streaming
      - "127.0.0.1:8000:8000"  # REST API
    volumes:
      - whisper-data:/var/lib/whisper-live
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    environment:
      - WHISPERLIVE_MODEL=large-v3-turbo

  n8n:
    image: n8nio/n8n
    ports:
      - "127.0.0.1:5678:5678"
    volumes:
      - n8n-data:/home/node/.n8n

volumes:
  whisper-data:
  n8n-data:
```

#### Mobile Apps for Self-Hosted:

| Platform | App | How it connects |
|----------|-----|-----------------|
| **iOS** | Diction | Native keyboard, connects to your Whisper API over Tailscale |
| **iOS** | Shortcuts DIY | HTTP POST to `http://100.x.x.x:8000/v1/audio/transcriptions` |
| **Android** | Kõnele | Custom speech server endpoint |
| **Both** | Browser PWA | Web Audio API + WebSocket to your server |

---

### 6. Kimi Cleanup Alternatives

**Finding**: Kimi API cleanup is likely adding 1-5 seconds of latency to every transcription.

**Alternatives to consider:**

| Option | Speed | Cost | Quality |
|--------|-------|------|---------|
| **Keep Kimi** | Slowest | Included? | Good |
| **GPT-4o mini via OpenRouter** | Faster | ~$0.0001/1K tokens | Similar |
| **Remove cleanup entirely** | Instant | Free | May have filler words |
| **Local small LLM (llama.cpp)** | Fast | Free (hardware) | Good enough |

**Recommendation**: Try removing the Kimi step entirely for a week. OpenAI's `gpt-4o-mini-transcribe` already does a good job with filler words. If you need cleanup, switch to GPT-4o mini via OpenRouter for faster response.

---

## Recommendations Summary

### Option A: Optimize Current Bot (Quick Wins)

1. **Remove or replace Kimi cleanup**
   - Try without cleanup first
   - If needed, use GPT-4o mini via OpenRouter

2. **Remove ffmpeg conversion**
   - OpenAI now supports more formats directly
   - Check if you can send .oga directly

3. **Optimize worker concurrency**
   - Currently 2 workers with Redis lock
   - Consider if this is actually needed with OpenAI API (not local Whisper)

**Expected improvement**: 1-3 seconds faster

---

### Option B: Telegram Mini App + Streaming (Medium Effort)

Build a Telegram Mini App that:
1. Opens inside Telegram (iframe)
2. Uses WebRTC to stream audio directly to your server
3. Your server streams to OpenAI Realtime API or local Whisper
4. Sends text back via Telegram Bot API

**Pros**:
- True real-time streaming (~0.5-1s latency)
- Still within Telegram ecosystem

**Cons**:
- Users must open Mini App instead of sending voice message
- Android permission issues
- Significant development effort

---

### Option C: Self-Hosted Pop!_OS + Tailscale (Best Long-term)

**Architecture**:
1. Install Tailscale on Pop!_OS desktop and phone
2. Run `docker-whisper-live` on desktop with GPU
3. Use **Diction** (iOS) or browser PWA to connect to your server
4. n8n webhook pushes transcriptions to Telegram/Google Docs

**Pros**:
- **~0.5-1.5s total latency** (vs 3-12s current)
- No per-minute API costs (after GPU investment)
- Fully private (audio never leaves your infrastructure)
- Work laptop can access via same Tailscale network

**Cons**:
- Desktop must be online
- Initial setup complexity
- No native "send voice message" UX (use app instead)

**Cost comparison** (1 hour/day dictation):
| Approach | Monthly Cost |
|----------|--------------|
| Current (OpenAI + Kimi) | ~$11-15 |
| Self-hosted (electricity only) | ~$2-5 |
| Realtime API | ~$50-100 |

---

### Option D: Hybrid Approach (Recommended)

Keep your current Telegram bot **AND** set up the Pop!_OS home server:

1. **On the go (no desktop access)**: Use Telegram bot (current)
2. **At home (desktop online)**: Use Diction/browser app pointing to home server
3. **Sync both to same destination**: n8n → Telegram or Google Docs

This gives you:
- Fast streaming when at home
- Fallback to current bot when away
- Same copy-paste workflow via Telegram/Docs

---

## Action Items

### Immediate (This Week)
1. **Try removing Kimi cleanup** for a few days — see if quality is acceptable
2. **Check if OpenAI can handle .oga files directly** — remove ffmpeg step

### Short-term (Next Month)
3. **Install Tailscale** on Pop!_OS and phone
4. **Test docker-whisper-live** locally
5. **Try Diction app** (iOS) or browser PWA

### Medium-term (Next Quarter)
6. **Set up n8n** for transcription sync
7. **Evaluate** if home server meets your speed needs
8. **Consider** deprecating the bot if home server is reliable

---

## Sources Consulted

This research synthesized findings from 50+ sources including:
- OpenAI Realtime API documentation
- Telegram Bot API official docs
- WhisperStreaming academic paper (3.3s latency benchmarks)
- faster-whisper benchmarks (20-50x real-time factor)
- Tailscale performance docs
- Multiple open-source dictation app repositories
- Docker Whisper server implementations

**Total research tokens**: ~500K across 5 parallel deep-research subagents
