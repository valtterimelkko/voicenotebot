import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../src/config';

const { mockFetch, mockChatCreate } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockChatCreate: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockChatCreate,
      },
    },
  })),
}));

import { cleanupTranscript } from '../src/services/cleanup';
import { resetForTesting } from '../src/services/connectionPool';

describe('cleanupTranscript with kimi', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    config.kimiApiKey = 'test-kimi-key';
    config.openaiApiKey = 'test-openai-key';
    resetForTesting();
  });

  it('calls Kimi endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'cleaned text' } }],
      }),
    });

    const result = await cleanupTranscript('raw text', 'kimi');
    expect(result.cleanedText).toBe('cleaned text');
    expect(result.model).toBe('kimi');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends correct Authorization header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'cleaned' } }],
      }),
    });

    await cleanupTranscript('raw', 'kimi');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers).toEqual({
      Authorization: 'Bearer test-kimi-key',
      'User-Agent': 'KimiCLI/1.0',
      'Content-Type': 'application/json',
    });
  });

  it('sends correct payload to Kimi', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'cleaned' } }],
      }),
    });

    await cleanupTranscript('raw input', 'kimi');

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe('kimi-for-coding');
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(60000);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('raw input');
  });

  it('sends request to correct endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'c' } }],
      }),
    });

    await cleanupTranscript('raw', 'kimi');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.kimi.com/coding/v1/chat/completions');
    expect(callArgs[1].method).toBe('POST');
  });

  it('falls back to raw text on empty response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '' } }],
      }),
    });

    const result = await cleanupTranscript('raw text here', 'kimi');
    expect(result.cleanedText).toBe('raw text here');
  });

  it('throws on Kimi HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(cleanupTranscript('raw', 'kimi')).rejects.toThrow('Kimi HTTP 500');
  });
});

describe('cleanupTranscript with gpt-5-nano', () => {
  beforeEach(() => {
    mockChatCreate.mockReset();
    config.openaiApiKey = 'test-openai-key';
    resetForTesting();
  });

  it('calls OpenAI chat completions', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'cleaned by openai' } }],
    });

    const result = await cleanupTranscript('raw text', 'gpt-5-nano');
    expect(result.cleanedText).toBe('cleaned by openai');
    expect(result.model).toBe('gpt-5-nano');
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it('sends correct model and messages to OpenAI', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'c' } }],
    });

    await cleanupTranscript('my transcript', 'gpt-5-nano');

    const callArgs = mockChatCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-5-nano');
    expect(callArgs.temperature).toBe(0.3);
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[1].role).toBe('user');
    expect(callArgs.messages[1].content).toContain('my transcript');
  });

  it('falls back to raw text on empty OpenAI response', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: '' } }],
    });

    const result = await cleanupTranscript('raw text fallback', 'gpt-5-nano');
    expect(result.cleanedText).toBe('raw text fallback');
  });
});
