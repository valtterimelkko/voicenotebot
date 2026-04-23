import OpenAI from 'openai';
import { config } from '../config';

const STT_MODEL = 'gpt-4o-mini-transcribe';

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: config.openaiApiKey });
}

export interface STTResult {
  text: string;
  model: string;
  usedFallback: boolean;
}

export async function streamTranscribe(audioChunks: Buffer[]): Promise<STTResult> {
  const client = getOpenAIClient();
  const audioBuffer = Buffer.concat(audioChunks);
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' });

  const response = await client.audio.transcriptions.create({
    model: STT_MODEL,
    file: blob as unknown as File,
    response_format: 'text',
  });

  return {
    text: typeof response === 'string' ? response : String(response),
    model: STT_MODEL,
    usedFallback: false,
  };
}

export async function batchTranscribe(audioBuffer: Buffer): Promise<STTResult> {
  const client = getOpenAIClient();
  const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });

  const response = await client.audio.transcriptions.create({
    model: STT_MODEL,
    file: file,
    response_format: 'text',
  });

  return {
    text: typeof response === 'string' ? response : String(response),
    model: STT_MODEL,
    usedFallback: true,
  };
}

export async function transcribeWithFallback(audioChunks: Buffer[]): Promise<STTResult> {
  try {
    return await streamTranscribe(audioChunks);
  } catch (primaryError) {
    console.error('primary STT failed, attempting batch fallback:', primaryError);
    const audioBuffer = Buffer.concat(audioChunks);
    return await batchTranscribe(audioBuffer);
  }
}
