import OpenAI from 'openai';
import { config } from '../config';

const KIMI_ENDPOINT = 'https://api.kimi.com/coding/v1/chat/completions';
const KIMI_MODEL = 'kimi-for-coding';
const OPENAI_CLEANUP_MODEL = 'gpt-5-nano';

const SYSTEM_PROMPT = "You are a transcription editor. Clean up voice transcripts with a LIGHT touch:\n1. Fix spelling and grammar mistakes only when they're clearly wrong\n2. Convert American spellings to British (color→colour, organize→organise, etc.)\n3. Remove filler words (um, uh, mmm, ooh, aah, öö, ääh, etc.)\n4. Fix obvious transcription errors\n5. Preserve the original language (don't translate)\n6. IMPORTANT: Keep the speaker's authentic voice, quirks, and natural speech patterns\n   - Do NOT remove sentences or restructure the flow\n   - Do NOT replace words just to make it sound more 'proper' or 'perfect'\n   - Do NOT smooth out rough edges or back-and-forth thinking\n   - Preserve non-native speaker expressions and authentic word choices\n   - Keep fragmented sentences if that's how the person speaks\n   - The transcript will be used for prompting LLMs, not for publication\n\nReturn ONLY the cleaned text, nothing else.";

export type CleanupModel = 'kimi' | 'gpt-5-nano';

export interface CleanupResult {
  cleanedText: string;
  model: CleanupModel;
}

export async function cleanupTranscript(rawText: string, model: CleanupModel): Promise<CleanupResult> {
  if (model === 'kimi') {
    return cleanupWithKimi(rawText);
  }
  return cleanupWithOpenAI(rawText);
}

async function cleanupWithKimi(transcriptText: string): Promise<CleanupResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const response = await fetch(KIMI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.kimiApiKey}`,
        'User-Agent': 'KimiCLI/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Clean up this transcript:\n\n${transcriptText}` },
        ],
        model: KIMI_MODEL,
        temperature: 0.3,
        max_tokens: 60000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Kimi HTTP ${response.status}: ${body}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const cleanedText = data?.choices?.[0]?.message?.content || '';

    return {
      cleanedText: cleanedText || transcriptText,
      model: 'kimi',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function cleanupWithOpenAI(transcriptText: string): Promise<CleanupResult> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const response = await client.chat.completions.create({
    model: OPENAI_CLEANUP_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Clean up this transcript:\n\n${transcriptText}` },
    ],
    temperature: 0.3,
  });

  const cleanedText = response.choices?.[0]?.message?.content || '';

  return {
    cleanedText: cleanedText || transcriptText,
    model: 'gpt-5-nano',
  };
}
