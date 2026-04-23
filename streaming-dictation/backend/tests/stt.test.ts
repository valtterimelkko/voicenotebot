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

import { streamTranscribe, batchTranscribe, transcribeWithFallback } from '../src/services/stt';

describe('streamTranscribe', () => {
  beforeEach(() => {
    mockTranscriptionCreate.mockReset();
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
});

describe('batchTranscribe', () => {
  beforeEach(() => {
    mockTranscriptionCreate.mockReset();
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
