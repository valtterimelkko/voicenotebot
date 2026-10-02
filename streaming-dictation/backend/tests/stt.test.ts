import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import http from 'node:http';

const { mockTranscriptionCreate } = vi.hoisted(() => ({
  mockTranscriptionCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    audio: {
      transcriptions: {
        create: mockTranscriptionCreate,
      },
    },
  })),
}));

const { configState } = vi.hoisted(() => ({
  configState: { openrouterApiKey: 'test-or-key' as string | undefined },
}));

vi.mock('../src/config', () => ({
  config: new Proxy(configState, {
    get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : undefined),
  }),
}));

vi.mock('../src/services/connectionPool', async () => {
  const actual = await vi.importActual<typeof import('../src/services/connectionPool')>(
    '../src/services/connectionPool',
  );
  return {
    ...actual,
    getSharedOpenAIClient: vi.fn(() => ({
      audio: { transcriptions: { create: mockTranscriptionCreate } },
    })),
  };
});

import { transcribeWithFallback, startSpeculativeTranscription, shouldUseSpeculative } from '../src/services/stt';
import { STT_MODEL } from '../src/services/models';

interface CapturedRequest {
  auth: string;
  body: Buffer;
  contentType: string;
}

function fakeSttServer(status: number, responseBody: object) {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push({
        auth: req.headers.authorization ?? '',
        body: Buffer.concat(chunks),
        contentType: String(req.headers['content-type'] ?? ''),
      });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });
  return new Promise<{ url: string; requests: CapturedRequest[]; close: () => void }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}/x`,
          requests,
          close: () => server.close(),
        });
      });
    },
  );
}

const savedEnv: Record<string, string | undefined> = {};
function setEnv(name: string, value: string | undefined) {
  savedEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('transcribeWithFallback tiers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configState.openrouterApiKey = 'test-or-key';
    setEnv('OPENROUTER_API_KEY', 'test-or-key');
    setEnv('OPENROUTER_STT_URL', undefined);
    setEnv('LOCAL_ASR_URL', undefined);
  });

  it('uses the OpenRouter whisper-turbo tier first (DeepInfra pin, webm body)', async () => {
    const fake = await fakeSttServer(200, { text: 'primary text' });
    setEnv('OPENROUTER_STT_URL', fake.url);
    try {
      const result = await transcribeWithFallback([Buffer.from('chunk-one'), Buffer.from('chunk-two')], 'vocab hint');
      expect(result.text).toBe('primary text');
      expect(result.model).toBe(STT_MODEL);
      expect(result.usedFallback).toBe(false);
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0].auth).toBe('Bearer test-or-key');
      const payload = JSON.parse(fake.requests[0].body.toString('utf8'));
      expect(payload.model).toBe('openai/whisper-large-v3-turbo');
      expect(payload.provider).toEqual({ order: ['DeepInfra'], allow_fallbacks: false });
      expect(payload.input_audio.format).toBe('webm');
      expect(Buffer.from(payload.input_audio.data, 'base64').toString()).toBe('chunk-onechunk-two');
      expect(payload.prompt).toBe('vocab hint');
      expect(mockTranscriptionCreate).not.toHaveBeenCalled();
    } finally {
      fake.close();
    }
  });

  it('falls back to the local Parakeet service when OpenRouter fails', async () => {
    const orFail = await fakeSttServer(500, { error: 'down' });
    const local = await fakeSttServer(200, { text: 'local text' });
    setEnv('OPENROUTER_STT_URL', orFail.url);
    setEnv('LOCAL_ASR_URL', local.url);
    try {
      const result = await transcribeWithFallback([Buffer.from('audio')]);
      expect(result.text).toBe('local text');
      expect(result.usedFallback).toBe(true);
      expect(result.model).toContain('parakeet');
      expect(local.requests).toHaveLength(1);
      expect(local.requests[0].contentType).toContain('multipart/form-data');
      expect(local.requests[0].body.toString('utf8')).toContain('name="audio_file"');
      expect(mockTranscriptionCreate).not.toHaveBeenCalled();
    } finally {
      orFail.close(); local.close();
    }
  });

  it('uses OpenAI gpt-transcribe as the last resort when both tiers fail', async () => {
    const orFail = await fakeSttServer(500, { error: 'down' });
    setEnv('OPENROUTER_STT_URL', orFail.url);
    setEnv('LOCAL_ASR_URL', 'http://127.0.0.1:9/asr'); // nothing listens
    mockTranscriptionCreate.mockResolvedValue('openai last resort text');
    try {
      const result = await transcribeWithFallback([Buffer.from('audio')]);
      expect(result.text).toBe('openai last resort text');
      expect(result.usedFallback).toBe(true);
      expect(result.model).toBe('gpt-transcribe');
      expect(mockTranscriptionCreate).toHaveBeenCalledTimes(1);
      const call = mockTranscriptionCreate.mock.calls[0][0];
      expect(call.model).toBe('gpt-transcribe');
    } finally {
      orFail.close();
    }
  });

  it('skips the OpenRouter tier entirely when no key is configured', async () => {
    configState.openrouterApiKey = '';
    const orFail = await fakeSttServer(200, { text: 'should not be reached' });
    const local = await fakeSttServer(200, { text: 'local text' });
    setEnv('OPENROUTER_STT_URL', orFail.url);
    setEnv('LOCAL_ASR_URL', local.url);
    try {
      const result = await transcribeWithFallback([Buffer.from('audio')]);
      expect(result.text).toBe('local text');
      expect(orFail.requests).toHaveLength(0);
    } finally {
      orFail.close(); local.close();
    }
  });
});

describe('speculative transcription contract (unchanged)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configState.openrouterApiKey = 'test-or-key';
    setEnv('OPENROUTER_API_KEY', 'test-or-key');
  });

  it('startSpeculativeTranscription snapshots chunks and resolves to a result', async () => {
    const fake = await fakeSttServer(200, { text: 'speculative text' });
    setEnv('OPENROUTER_STT_URL', fake.url);
    try {
      const spec = startSpeculativeTranscription([Buffer.from('a'), Buffer.from('b')]);
      expect(spec.chunkCount).toBe(2);
      const result = await spec.promise;
      expect(result.text).toBe('speculative text');
    } finally {
      fake.close();
    }
  });

  it('shouldUseSpeculative keeps the reuse-ratio rule', () => {
    const spec = { promise: Promise.resolve({ text: '', model: '', usedFallback: false }), chunkCount: 10, startedAt: 0 };
    expect(shouldUseSpeculative(spec, 8)).toBe(true);
    expect(shouldUseSpeculative(spec, 10)).toBe(true);
    expect(shouldUseSpeculative(spec, 11)).toBe(true);   // 1/11 new < 0.3
    expect(shouldUseSpeculative(spec, 20)).toBe(false);  // 10/20 new >= 0.3
  });
});
