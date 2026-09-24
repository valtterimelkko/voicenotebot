import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../src/config';

const { mockChatCreate } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockChatCreate,
      },
    },
  })),
}));

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
    // gpt-5-nano only supports the default temperature (1); sending any
    // other value (e.g. 0.3) is rejected with a 400 "Unsupported value"
    // error, so the request must omit the parameter entirely.
    expect(callArgs.temperature).toBeUndefined();
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

  it('appends vocabulary to system prompt when provided', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'cleaned' } }],
    });

    await cleanupTranscript('raw', 'gpt-5-nano', 'Claude\nAnthropic');

    const callArgs = mockChatCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('Claude');
    expect(callArgs.messages[0].content).toContain('Anthropic');
  });
});

describe('applyBritishSpelling', () => {
  it('converts -ize to -ise', () => {
    expect(applyBritishSpelling('I realize this is important')).toBe('I realise this is important');
    expect(applyBritishSpelling('We need to organize the meeting')).toBe('We need to organise the meeting');
    expect(applyBritishSpelling('Please summarize the report')).toBe('Please summarise the report');
  });

  it('converts -ized to -ised', () => {
    expect(applyBritishSpelling('He optimized the code')).toBe('He optimised the code');
    expect(applyBritishSpelling('They finalized the deal')).toBe('They finalised the deal');
    expect(applyBritishSpelling('It was overemphasized')).toBe('It was overemphasised');
  });

  it('converts -izing to -ising', () => {
    expect(applyBritishSpelling('I am realizing my potential')).toBe('I am realising my potential');
    expect(applyBritishSpelling('She is optimizing the process')).toBe('She is optimising the process');
  });

  it('converts -ization to -isation', () => {
    expect(applyBritishSpelling('The optimization of the system')).toBe('The optimisation of the system');
    expect(applyBritishSpelling('The realization of our goals')).toBe('The realisation of our goals');
    expect(applyBritishSpelling('The organization of the event')).toBe('The organisation of the event');
  });

  it('preserves -ize exceptions', () => {
    expect(applyBritishSpelling('The file size is large')).toBe('The file size is large');
    expect(applyBritishSpelling('Police seize the assets')).toBe('Police seize the assets');
    expect(applyBritishSpelling('The boat may capsize')).toBe('The boat may capsize');
  });

  it('preserves words already in British spelling', () => {
    expect(applyBritishSpelling('I realise this is important')).toBe('I realise this is important');
    expect(applyBritishSpelling('We need to organise the meeting')).toBe('We need to organise the meeting');
  });

  it('handles multiple conversions in one text', () => {
    const input = 'We must optimize and realize that summarizing is key. He finalized it.';
    const expected = 'We must optimise and realise that summarising is key. He finalised it.';
    expect(applyBritishSpelling(input)).toBe(expected);
  });

  it('preserves case of surrounding letters', () => {
    expect(applyBritishSpelling('Realize')).toBe('Realise');
    expect(applyBritishSpelling('Optimized')).toBe('Optimised');
    expect(applyBritishSpelling('ORGANIZATION')).toBe('ORGANISATION');
  });
});
