import OpenAI from 'openai';
import https from 'https';
import http from 'http';
import { config } from '../config';

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 4,
});

const keepAliveHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 4,
});

let openaiClient: OpenAI | null = null;
let warmedUp = false;

export function getSharedOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey,
      httpAgent: config.openaiApiKey ? keepAliveAgent : keepAliveHttpAgent,
    });
  }
  return openaiClient;
}

export function isWarmedUp(): boolean {
  return warmedUp;
}

export async function warmupConnections(): Promise<void> {
  getSharedOpenAIClient();
  warmedUp = true;
}

export function resetForTesting(): void {
  openaiClient = null;
  warmedUp = false;
}
