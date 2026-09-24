import { getSharedOpenAIClient } from './connectionPool';

const OPENAI_CLEANUP_MODEL = 'gpt-5-nano';

const SYSTEM_PROMPT = "You are a transcription editor. Clean up voice transcripts with a LIGHT touch:\n1. Fix spelling and grammar mistakes only when they're clearly wrong\n2. Convert American spellings to British (color→colour, organize→organise, etc.)\n3. Remove filler words (um, uh, mmm, ooh, aah, öö, ääh, etc.)\n4. Fix obvious transcription errors\n5. Preserve the original language (don't translate)\n6. IMPORTANT: Keep the speaker's authentic voice, quirks, and natural speech patterns\n   - Do NOT remove sentences or restructure the flow\n   - Do NOT replace words just to make it sound more 'proper' or 'perfect'\n   - Do NOT smooth out rough edges or back-and-forth thinking\n   - Preserve non-native speaker expressions and authentic word choices\n   - Keep fragmented sentences if that's how the person speaks\n   - The transcript will be used for prompting LLMs, not for publication\n\nReturn ONLY the cleaned text, nothing else.";

/** Words ending in -ize that should NOT be converted to -ise. */
const IZE_EXCEPTIONS = new Set(['size', 'seize', 'capsize']);

/**
 * Apply British spelling post-processing to a transcript.
 * gpt-5-nano often fails to consistently convert -ize → -ise despite
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

export type CleanupModel = 'gpt-5-nano';

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
  return cleanupWithOpenAI(rawText, vocabulary);
}

async function cleanupWithOpenAI(transcriptText: string, vocabulary?: string): Promise<CleanupResult> {
  const client = getSharedOpenAIClient();

  // gpt-5-nano only supports the default temperature (1) — passing any
  // other value (e.g. 0.3) is rejected with a 400 "Unsupported value"
  // error, so the parameter is intentionally omitted here.
  const response = await client.chat.completions.create({
    model: OPENAI_CLEANUP_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(vocabulary) },
      { role: 'user', content: `Clean up this transcript:\n\n${transcriptText}` },
    ],
  });

  let cleanedText = response.choices?.[0]?.message?.content || '';

  // Post-process: gpt-5-nano is inconsistent with British -ise spelling
  if (cleanedText) {
    cleanedText = applyBritishSpelling(cleanedText);
  }

  return {
    cleanedText: cleanedText || transcriptText,
    model: 'gpt-5-nano',
  };
}
