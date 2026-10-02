import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../src/config';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

import { cleanupTranscript, applyBritishSpelling } from '../src/services/cleanup';
import { resetForTesting } from '../src/services/connectionPool';

describe('cleanupTranscript never calls Kimi', () => {
  it('has no Kimi API key in config', () => {
    expect((config as Record<string, unknown>).kimiApiKey).toBeUndefined();
  });

  it('module source does not reference the Kimi endpoint', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/cleanup.ts'),
      'utf-8'
    );
    expect(source.toLowerCase()).not.toContain('kimi');
  });
});

describe('cleanupTranscript with gemma-4-26b-a4b-it via OpenRouter', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    config.openrouterApiKey = 'test-openrouter-key';
    resetForTesting();
  });

  function okResponse(content: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'google/gemma-4-26b-a4b-it',
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 90 },
      }),
    } as unknown as Response;
  }

  it('posts the production prompt to the OpenRouter chat endpoint', async () => {
    fetchMock.mockResolvedValue(okResponse('cleaned by gemma'));

    const result = await cleanupTranscript('my transcript', 'google/gemma-4-26b-a4b-it');

    expect(result.cleanedText).toBe('cleaned by gemma');
    expect(result.model).toBe('google/gemma-4-26b-a4b-it');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-openrouter-key');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('google/gemma-4-26b-a4b-it');
    // B5 benchmarked gemma at temperature 0.3 — keep production identical
    expect(body.temperature).toBe(0.3);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toContain('my transcript');
    // gemma-4-26b-a4b-it is a non-reasoning model: no reasoning controls
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('appends the STT vocabulary to the system prompt when provided', async () => {
    fetchMock.mockResolvedValue(okResponse('c'));

    await cleanupTranscript('raw', 'google/gemma-4-26b-a4b-it', 'Jev, TypeSafe');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('Jev, TypeSafe');
  });

  it('applies the British spelling post-process to the model output', async () => {
    fetchMock.mockResolvedValue(okResponse('we organize the color palette'));

    const result = await cleanupTranscript('raw', 'google/gemma-4-26b-a4b-it');
    expect(result.cleanedText).toContain('organise');
  });

  it('falls back to the raw text on an empty response', async () => {
    fetchMock.mockResolvedValue(okResponse(''));

    const result = await cleanupTranscript('raw text fallback', 'google/gemma-4-26b-a4b-it');
    expect(result.cleanedText).toBe('raw text fallback');
  });

  it('rejects when OpenRouter fails after its retry, so the route logs and falls back', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 } as unknown as Response);

    await expect(
      cleanupTranscript('raw text on error', 'google/gemma-4-26b-a4b-it')
    ).rejects.toThrow('OpenRouter HTTP 502');
    // first attempt + one retry, not an unbounded loop
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on a transient 500 and succeeds on the second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
      .mockResolvedValueOnce(okResponse('second attempt worked'));

    const result = await cleanupTranscript('raw', 'google/gemma-4-26b-a4b-it');
    expect(result.cleanedText).toBe('second attempt worked');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('applyBritishSpelling', () => {
  it('converts -ize family to -ise and preserves exceptions', () => {
    expect(applyBritishSpelling('we organize and prioritize the size')).toBe(
      'we organise and prioritise the size'
    );
  });
});
