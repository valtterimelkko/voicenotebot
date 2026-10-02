import { CLEANUP_MODEL } from './models';
import { config } from '../config';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = "You are a transcription editor. Clean up voice transcripts with a LIGHT touch:\n1. Fix spelling and grammar mistakes only when they're clearly wrong\n2. Convert American spellings to British (color→colour, organize→organise, etc.)\n3. Remove filler words (um, uh, mmm, ooh, aah, öö, ääh, etc.)\n4. Fix obvious transcription errors\n5. Preserve the original language (don't translate)\n6. IMPORTANT: Keep the speaker's authentic voice, quirks, and natural speech patterns\n   - Do NOT remove sentences or restructure the flow\n   - Do NOT replace words just to make it sound more 'proper' or 'perfect'\n   - Do NOT smooth out rough edges or back-and-forth thinking\n   - Preserve non-native speaker expressions and authentic word choices\n   - Keep fragmented sentences if that's how the person speaks\n   - The transcript will be used for prompting LLMs, not for publication\n\nReturn ONLY the cleaned text, nothing else.";

/** Words ending in -ize that should NOT be converted to -ise. */
const IZE_EXCEPTIONS = new Set(['size', 'seize', 'capsize']);

/**
 * Apply British spelling post-processing to a transcript.
 * Gemma 4 often fails to consistently convert -ize → -ise despite
 * the system prompt instruction. This lightweight regex pass fixes
 * the most common omission without adding perceptible latency.
 */
export function applyBritishSpelling(text: string): string {
  return text.replace(
    /\b([a-zA-Z]*[iy])z(e|es|ed|ing|ation|ations|er|ers)\b/gi,
    (match) => {
      const lower = match.toLowerCase();
      if (IZE_EXCEPTIONS.has(lower)) return match;
      // Replace z/Z with s/S, preserving case of surrounding letters
      const zIndex = match.toLowerCase().indexOf('z');
      const replacement = match[zIndex] === 'Z' ? 'S' : 's';
      return match.slice(0, zIndex) + replacement + match.slice(zIndex + 1);
    }
  );
}

export type CleanupModel = 'google/gemma-4-26b-a4b-it';

export interface CleanupResult {
  cleanedText: string;
  model: CleanupModel;
}

function buildSystemPrompt(vocabulary?: string): string {
  if (!vocabulary || vocabulary.trim().length === 0) {
    return SYSTEM_PROMPT;
  }
  return `${SYSTEM_PROMPT}\n\nAdditional context — the speaker uses these terms frequently. When a phonetically similar word appears in a context where the technical term is clearly intended, prefer the technical term:\n${vocabulary.trim()}`;
}

export async function cleanupTranscript(rawText: string, _model: CleanupModel, vocabulary?: string): Promise<CleanupResult> {
  return cleanupWithOpenRouter(rawText, vocabulary);
}

async function callOpenRouter(transcriptText: string, vocabulary: string | undefined, apiKey: string): Promise<string> {
  // B5 benchmarked this exact shape on real transcripts (97.4/100, zero
  // ungrounded content words): temperature 0.3, production system prompt.
  // gemma-4-26b-a4b-it is a non-reasoning model — no reasoning controls,
  // which is where the latency win over gpt-5-nano comes from.
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'streaming-dictation',
    },
    body: JSON.stringify({
      model: CLEANUP_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: buildSystemPrompt(vocabulary) },
        { role: 'user', content: `Clean up this transcript:\n\n${transcriptText}` },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter HTTP ${response.status}`);
  }
  const data = await response.json() as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function cleanupWithOpenRouter(transcriptText: string, vocabulary?: string): Promise<CleanupResult> {
  if (!config.openrouterApiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }
  const apiKey = config.openrouterApiKey;

  let cleanedText = '';
  // One retry for transient 429/5xx — OpenRouter routes can blip; cleanup
  // is best-effort so a second failure falls back to raw text upstream.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      cleanedText = await callOpenRouter(transcriptText, vocabulary, apiKey);
      break;
    } catch (err) {
      if (attempt === 1) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }

  // Post-process: gemma-4 is inconsistent with British -ise spelling
  if (cleanedText) {
    cleanedText = applyBritishSpelling(cleanedText);
  }

  return {
    cleanedText: cleanedText || transcriptText,
    model: CLEANUP_MODEL,
  };
}
