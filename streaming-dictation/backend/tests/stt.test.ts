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
  configState: { xaiApiKey: 'test-xai-key' as string | undefined },
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
    configState.xaiApiKey = 'test-xai-key';
        setEnv('XAI_STT_URL', undefined);
    setEnv('LOCAL_ASR_URL', undefined);
  });

  it('uses the xAI Grok STT tier first (multipart, file last, key terms from the vocabulary)', async () => {
    const fake = await fakeSttServer(200, { text: 'primary text' });
    setEnv('XAI_STT_URL', fake.url);
    try {
      const result = await transcribeWithFallback([Buffer.from('chunk-one'), Buffer.from('chunk-two')], 'Agent OS, Pi Web UI,  Lifetime ISA');
      expect(result.text).toBe('primary text');
      expect(result.model).toBe(STT_MODEL);
      expect(result.model).toBe('grok-voice-transcribe-2.0');
      expect(result.usedFallback).toBe(false);
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0].auth).toBe('Bearer test-xai-key');
      expect(fake.requests[0].contentType).toContain('multipart/form-data');
      const body = fake.requests[0].body.toString('utf8');
      expect(body).toMatch(/name="model"\r\n\r\ngrok-voice-transcribe-2.0\r\n/);
      expect(body).toMatch(/name="language"\r\n\r\nen\r\n/);
      expect(body).toMatch(/name="keyterm"\r\n\r\nAgent OS\r\n/);
      expect(body).toMatch(/name="keyterm"\r\n\r\nPi Web UI\r\n/);
      expect(body).toMatch(/name="keyterm"\r\n\r\nLifetime ISA\r\n/);
      expect(body).toContain('chunk-onechunk-two');
      // xAI requires the file to be the LAST multipart field.
      expect(body.lastIndexOf('name="file"')).toBeGreaterThan(body.lastIndexOf('name="keyterm"'));
      expect(body.lastIndexOf('name="file"')).toBeGreaterThan(body.lastIndexOf('name="language"'));
      expect(mockTranscriptionCreate).not.toHaveBeenCalled();
    } finally {
      fake.close();
    }
  });

  it('caps key terms at 100 terms of 50 characters', async () => {
    const fake = await fakeSttServer(200, { text: 'ok' });
    setEnv('XAI_STT_URL', fake.url);
    try {
      const many = Array.from({ length: 130 }, (_, i) => `term${i}`).join(', ') + ', ' + 'x'.repeat(80);
      await transcribeWithFallback([Buffer.from('a')], many);
      const body = fake.requests[0].body.toString('utf8');
      expect((body.match(/name="keyterm"/g) ?? []).length).toBe(100);
      expect(body).not.toMatch(/x{51}/);
    } finally {
      fake.close();
    }
  });

  it('falls back to the local ASR service when xAI fails', async () => {
    const xaiFail = await fakeSttServer(500, { error: 'down' });
    const local = await fakeSttServer(200, { text: 'local text' });
    setEnv('XAI_STT_URL', xaiFail.url);
    setEnv('LOCAL_ASR_URL', local.url);
    try {
      const result = await transcribeWithFallback([Buffer.from('audio')]);
      expect(result.text).toBe('local text');
      expect(result.usedFallback).toBe(true);
      expect(result.model).toBe('local-asr');
      expect(local.requests).toHaveLength(1);
      expect(local.requests[0].contentType).toContain('multipart/form-data');
      expect(local.requests[0].body.toString('utf8')).toContain('name="audio_file"');
      expect(mockTranscriptionCreate).not.toHaveBeenCalled();
    } finally {
      xaiFail.close(); local.close();
    }
  });

  it('uses OpenAI gpt-transcribe as the last resort when both tiers fail', async () => {
    const xaiFail = await fakeSttServer(500, { error: 'down' });
    setEnv('XAI_STT_URL', xaiFail.url);
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
      xaiFail.close();
    }
  });

  it('skips the xAI tier entirely when no key is configured', async () => {
    configState.xaiApiKey = '';
    const xaiFail = await fakeSttServer(200, { text: 'should not be reached' });
    const local = await fakeSttServer(200, { text: 'local text' });
    setEnv('XAI_STT_URL', xaiFail.url);
    setEnv('LOCAL_ASR_URL', local.url);
    try {
      const result = await transcribeWithFallback([Buffer.from('audio')]);
      expect(result.text).toBe('local text');
      expect(xaiFail.requests).toHaveLength(0);
    } finally {
      xaiFail.close(); local.close();
    }
  });
});

describe('language pinning (wrong-language transcript fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configState.xaiApiKey = 'test-xai-key';
        setEnv('XAI_STT_URL', undefined);
    setEnv('LOCAL_ASR_URL', undefined);
  });

  it('pins the configured language in the xAI request', async () => {
    const fake = await fakeSttServer(200, { text: 'pinned text' });
    setEnv('XAI_STT_URL', fake.url);
    try {
      await transcribeWithFallback([Buffer.from('audio')], undefined, 'en');
      expect(fake.requests).toHaveLength(1);
      const body = fake.requests[0].body.toString('utf8');
      expect(body).toMatch(/name="language"\r\n\r\nen\r\n/);
    } finally {
      fake.close();
    }
  });

  it('omits the language field when language is auto', async () => {
    const fake = await fakeSttServer(200, { text: 'auto text' });
    setEnv('XAI_STT_URL', fake.url);
    try {
      await transcribeWithFallback([Buffer.from('audio')], undefined, 'auto');
      expect(fake.requests[0].body.toString('utf8')).not.toContain('name="language"');
    } finally {
      fake.close();
    }
  });

  it('passes the configured language to the local ASR fallback', async () => {
    const xaiFail = await fakeSttServer(500, { error: 'down' });
    const local = await fakeSttServer(200, { text: 'local text' });
    setEnv('XAI_STT_URL', xaiFail.url);
    setEnv('LOCAL_ASR_URL', local.url);
    try {
      await transcribeWithFallback([Buffer.from('audio')], undefined, 'fi');
      const body = local.requests[0].body.toString('utf8');
      expect(body).toContain('name="language"');
      expect(body).toMatch(/name="language"\r\n\r\nfi\r\n/);
    } finally {
      xaiFail.close(); local.close();
    }
  });

  it('passes the language to the OpenAI last-resort tier', async () => {
    const xaiFail = await fakeSttServer(500, { error: 'down' });
    setEnv('XAI_STT_URL', xaiFail.url);
    setEnv('LOCAL_ASR_URL', 'http://127.0.0.1:9/asr'); // nothing listens
    mockTranscriptionCreate.mockResolvedValue('openai last resort text');
    try {
      await transcribeWithFallback([Buffer.from('audio')], undefined, 'en');
      expect(mockTranscriptionCreate).toHaveBeenCalledTimes(1);
      expect(mockTranscriptionCreate.mock.calls[0][0].language).toBe('en');
    } finally {
      xaiFail.close();
    }
  });

  it('startSpeculativeTranscription carries the language pin', async () => {
    const fake = await fakeSttServer(200, { text: 'speculative text' });
    setEnv('XAI_STT_URL', fake.url);
    try {
      const spec = startSpeculativeTranscription([Buffer.from('a')], undefined, 'en');
      await spec.promise;
      expect(fake.requests[0].body.toString('utf8')).toMatch(/name="language"\r\n\r\nen\r\n/);
    } finally {
      fake.close();
    }
  });
});

describe('speculative transcription contract (unchanged)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configState.xaiApiKey = 'test-xai-key';
      });

  it('startSpeculativeTranscription snapshots chunks and resolves to a result', async () => {
    const fake = await fakeSttServer(200, { text: 'speculative text' });
    setEnv('XAI_STT_URL', fake.url);
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
