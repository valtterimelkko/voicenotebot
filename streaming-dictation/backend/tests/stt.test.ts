import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { streamTranscribe, batchTranscribe, transcribeWithFallback, startSpeculativeTranscription, shouldUseSpeculative } from '../src/services/stt';
import { resetForTesting } from '../src/services/connectionPool';

describe('streamTranscribe', () => {
  beforeEach(() => {
    mockTranscriptionCreate.mockReset();
    resetForTesting();
  });

  it('returns transcribed text', async () => {
    mockTranscriptionCreate.mockResolvedValue('hello world from stream');

    const result = await streamTranscribe([Buffer.from('audio-chunk')]);

    expect(result.text).toBe('hello world from stream');
    expect(result.usedFallback).toBe(false);
    expect(result.model).toBe('gpt-4o-mini-transcribe');
  });

  it('passes concatenated audio chunks to the API', async () => {
    mockTranscriptionCreate.mockResolvedValue('text');

    await streamTranscribe([Buffer.from('chunk1'), Buffer.from('chunk2')]);

    expect(mockTranscriptionCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockTranscriptionCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o-mini-transcribe');
    expect(callArgs.response_format).toBe('text');
  });

  it('passes prompt when provided', async () => {
    mockTranscriptionCreate.mockResolvedValue('text with prompt');

    await streamTranscribe([Buffer.from('chunk1')], 'Claude, Anthropic');

    expect(mockTranscriptionCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockTranscriptionCreate.mock.calls[0][0];
    expect(callArgs.prompt).toBe('Claude, Anthropic');
  });

  it('does not include prompt key when undefined', async () => {
    mockTranscriptionCreate.mockResolvedValue('text');

    await streamTranscribe([Buffer.from('chunk1')]);

    const callArgs = mockTranscriptionCreate.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('prompt');
  });
});

describe('batchTranscribe', () => {
  beforeEach(() => {
    mockTranscriptionCreate.mockReset();
    resetForTesting();
  });

  it('returns transcribed text with usedFallback=true', async () => {
    mockTranscriptionCreate.mockResolvedValue('batch result');

    const result = await batchTranscribe(Buffer.from('audio-buffer'));

    expect(result.text).toBe('batch result');
    expect(result.usedFallback).toBe(true);
    expect(result.model).toBe('gpt-4o-mini-transcribe');
  });
});

describe('transcribeWithFallback', () => {
  beforeEach(() => {
    mockTranscriptionCreate.mockReset();
    resetForTesting();
  });

  it('calls streamTranscribe first', async () => {
    mockTranscriptionCreate.mockResolvedValue('stream result');

    const result = await transcribeWithFallback([Buffer.from('audio')]);

    expect(result.text).toBe('stream result');
    expect(result.usedFallback).toBe(false);
  });

  it('falls back to batch on stream failure', async () => {
    mockTranscriptionCreate
      .mockRejectedValueOnce(new Error('stream failed'))
      .mockResolvedValueOnce('fallback result');

    const result = await transcribeWithFallback([Buffer.from('audio')]);

    expect(result.text).toBe('fallback result');
    expect(result.usedFallback).toBe(true);
    expect(mockTranscriptionCreate).toHaveBeenCalledTimes(2);
  });
});

describe('startSpeculativeTranscription', () => {
  beforeEach(() => {
    mockTranscriptionCreate.mockReset();
    resetForTesting();
  });

  it('returns a speculative result with promise and chunk count', () => {
    mockTranscriptionCreate.mockReturnValue(new Promise(() => {}));
    const chunks = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')];

    const result = startSpeculativeTranscription(chunks);

    expect(result.chunkCount).toBe(3);
    expect(result.startedAt).toBeGreaterThan(0);
    expect(result.promise).toBeInstanceOf(Promise);
  });

  it('copies chunks so mutation does not affect the promise', () => {
    mockTranscriptionCreate.mockReturnValue(new Promise(() => {}));
    const chunks = [Buffer.from('a')];

    const result = startSpeculativeTranscription(chunks);
    chunks.push(Buffer.from('b'));

    expect(result.chunkCount).toBe(1);
  });

  it('resolves to a valid STTResult', async () => {
    mockTranscriptionCreate.mockResolvedValue('speculative text');

    const result = startSpeculativeTranscription([Buffer.from('audio')]);
    const sttResult = await result.promise;

    expect(sttResult.text).toBe('speculative text');
    expect(sttResult.model).toBe('gpt-4o-mini-transcribe');
  });
});

describe('shouldUseSpeculative', () => {
  it('returns true when total chunks equal speculative chunks', () => {
    const speculative = { promise: Promise.resolve({ text: '', model: '', usedFallback: false }), chunkCount: 5, startedAt: Date.now() };
    expect(shouldUseSpeculative(speculative, 5)).toBe(true);
  });

  it('returns true when fewer than 30% new chunks arrived', () => {
    const speculative = { promise: Promise.resolve({ text: '', model: '', usedFallback: false }), chunkCount: 8, startedAt: Date.now() };
    expect(shouldUseSpeculative(speculative, 10)).toBe(true);
  });

  it('returns false when more than 30% new chunks arrived', () => {
    const speculative = { promise: Promise.resolve({ text: '', model: '', usedFallback: false }), chunkCount: 5, startedAt: Date.now() };
    expect(shouldUseSpeculative(speculative, 10)).toBe(false);
  });

  it('returns false when speculative had very few chunks and many more arrived', () => {
    const speculative = { promise: Promise.resolve({ text: '', model: '', usedFallback: false }), chunkCount: 2, startedAt: Date.now() };
    expect(shouldUseSpeculative(speculative, 10)).toBe(false);
  });

  it('returns true when total chunks is less than speculative', () => {
    const speculative = { promise: Promise.resolve({ text: '', model: '', usedFallback: false }), chunkCount: 5, startedAt: Date.now() };
    expect(shouldUseSpeculative(speculative, 4)).toBe(true);
  });
});
