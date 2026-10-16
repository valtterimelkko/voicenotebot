import { config } from '../config';
import { getSharedOpenAIClient } from './connectionPool';
import { STT_MODEL, STT_FALLBACK_MODEL } from './models';

export { STT_MODEL };

const XAI_STT_URL_DEFAULT = 'https://api.x.ai/v1/stt';
const LOCAL_ASR_URL_DEFAULT = 'http://127.0.0.1:9000/asr';
const XAI_TIMEOUT_MS = 60_000;
const XAI_MAX_KEYTERMS = 100;
const XAI_MAX_KEYTERM_CHARS = 50;

// Resolved at call time so tests (and ops) can redirect endpoints via env.
function xaiSttUrl(): string {
  return process.env.XAI_STT_URL || XAI_STT_URL_DEFAULT;
}
function localAsrUrl(): string {
  return process.env.LOCAL_ASR_URL || LOCAL_ASR_URL_DEFAULT;
}

export interface STTResult {
  text: string;
  model: string;
  usedFallback: boolean;
}

/**
 * STT language: 'auto' lets the ASR model detect the language per clip
 * (Whisper's detection is unreliable on short/ambiguous audio and can return
 * the transcript in the wrong language); any ISO-639-1 code pins it.
 */
export type SttLanguage = string;
const isAuto = (language: SttLanguage | undefined): boolean =>
  !language || language === 'auto';

/** Split the comma/newline separated custom vocabulary into xAI key terms. */
function toKeyterms(vocabulary?: string): string[] {
  if (!vocabulary) return [];
  return vocabulary
    .split(/[,\n]/)
    .map((t) => t.trim().slice(0, XAI_MAX_KEYTERM_CHARS))
    .filter(Boolean)
    .slice(0, XAI_MAX_KEYTERMS);
}

/**
 * Tier 1 (primary): xAI Grok speech-to-text (`grok-voice-transcribe-2.0`).
 * Chosen 2026-10-16 on the operator's real voice: no phantom "Thank you."
 * on pauses/quiet audio (which whisper-large-v3-turbo produced), ~1.2-2 s
 * for a 47 s clip, $0.10 per audio hour. It keeps stutters and spells numbers
 * out; the cleanup model normalises both. The vocabulary becomes key terms.
 * xAI requires the `file` multipart field to come last.
 */
async function xaiTranscribe(audioChunks: Buffer[], prompt?: string, language: SttLanguage = 'en'): Promise<STTResult> {
  if (!config.xaiApiKey) {
    throw new Error('XAI_API_KEY is not configured');
  }
  const audioBuffer = Buffer.concat(audioChunks);
  const form = new FormData();
  form.append('model', STT_MODEL);
  if (!isAuto(language)) form.append('language', language);
  for (const term of toKeyterms(prompt)) form.append('keyterm', term);
  form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' }), 'audio.webm');
  const response = await fetch(xaiSttUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.xaiApiKey}` },
    body: form,
    signal: AbortSignal.timeout(XAI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`xAI STT HTTP ${response.status}: ${detail.slice(0, 200)}`);
  }
  const payload = (await response.json()) as { text?: string };
  const text = (payload.text ?? '').trim();
  if (!text) throw new Error('xAI STT returned an empty transcript');
  return { text, model: STT_MODEL, usedFallback: false };
}

/**
 * Tier 2: the host's local ASR service (Whisper-compatible multipart API on
 * 127.0.0.1:9000; Fluid Speech Mini since 2026-10-14). Free, offline, keeps
 * dictation working when the cloud route is down (slower: ~7 s per 47 s).
 */
async function localTranscribe(audioChunks: Buffer[], language: SttLanguage = 'en'): Promise<STTResult> {
  const audioBuffer = Buffer.concat(audioChunks);
  const form = new FormData();
  if (!isAuto(language)) form.append('language', language);
  form.append('audio_file', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' }), 'audio.webm');
  const response = await fetch(localAsrUrl(), { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`local ASR HTTP ${response.status}`);
  }
  const raw = await response.text();
  let text = raw.trim();
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    if (typeof parsed.text === 'string') text = parsed.text.trim();
  } catch {
    // plain-text response — keep as-is
  }
  if (!text) throw new Error('local ASR returned an empty transcript');
  return { text, model: 'local-asr', usedFallback: true };
}

/**
 * Tier 3 (last resort): OpenAI gpt-transcribe on the native API (the
 * successor model, not affected by the 2027-02-26 removal of the gpt-4o
 * family). Keeps dictation alive if both xAI and the local service are down.
 */
async function openAITranscribe(audioChunks: Buffer[], prompt?: string, language: SttLanguage = 'en'): Promise<STTResult> {
  const client = getSharedOpenAIClient();
  const audioBuffer = Buffer.concat(audioChunks);
  const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
  const response = await client.audio.transcriptions.create({
    model: STT_FALLBACK_MODEL,
    file,
    response_format: 'text',
    ...(prompt ? { prompt } : {}),
    ...(!isAuto(language) ? { language } : {}),
  });
  return {
    text: typeof response === 'string' ? response : String(response),
    model: STT_FALLBACK_MODEL,
    usedFallback: true,
  };
}

export async function transcribeWithFallback(audioChunks: Buffer[], prompt?: string, language: SttLanguage = 'en'): Promise<STTResult> {
  try {
    return await xaiTranscribe(audioChunks, prompt, language);
  } catch (primaryError) {
    console.error('primary STT (xAI) failed, trying local ASR:', primaryError);
  }
  try {
    return await localTranscribe(audioChunks, language);
  } catch (localError) {
    console.error('local ASR failed, falling back to OpenAI gpt-transcribe:', localError);
  }
  return openAITranscribe(audioChunks, prompt, language);
}

export interface SpeculativeResult {
  promise: Promise<STTResult>;
  chunkCount: number;
  startedAt: number;
}

export function startSpeculativeTranscription(chunks: Buffer[], prompt?: string, language: SttLanguage = 'en'): SpeculativeResult {
  const chunksCopy = chunks.map(c => Buffer.from(c));
  return {
    promise: transcribeWithFallback(chunksCopy, prompt, language),
    chunkCount: chunks.length,
    startedAt: Date.now(),
  };
}

export function shouldUseSpeculative(
  speculative: SpeculativeResult,
  totalChunks: number
): boolean {
  if (totalChunks <= speculative.chunkCount) return true;
  const newChunksRatio = (totalChunks - speculative.chunkCount) / totalChunks;
  return newChunksRatio < 0.3;
}
