import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSharedOpenAIClient, isWarmedUp, warmupConnections, resetForTesting } from '../src/services/connectionPool';

describe('connectionPool', () => {
  beforeEach(() => {
    resetForTesting();
  });

  it('isWarmedUp returns false initially', () => {
    expect(isWarmedUp()).toBe(false);
  });

  it('getSharedOpenAIClient returns a client instance', () => {
    const client = getSharedOpenAIClient();
    expect(client).toBeDefined();
    expect(typeof client.audio.transcriptions.create).toBe('function');
  });

  it('getSharedOpenAIClient returns the same instance on repeated calls', () => {
    const client1 = getSharedOpenAIClient();
    const client2 = getSharedOpenAIClient();
    expect(client1).toBe(client2);
  });

  it('warmupConnections sets warmedUp to true', async () => {
    expect(isWarmedUp()).toBe(false);
    await warmupConnections();
    expect(isWarmedUp()).toBe(true);
  });

  it('warmupConnections creates the shared client', async () => {
    await warmupConnections();
    const client = getSharedOpenAIClient();
    expect(client).toBeDefined();
  });

  it('resetForTesting clears the singleton', () => {
    const client1 = getSharedOpenAIClient();
    resetForTesting();
    const client2 = getSharedOpenAIClient();
    expect(client1).not.toBe(client2);
  });

  it('resetForTesting resets warmedUp', async () => {
    await warmupConnections();
    expect(isWarmedUp()).toBe(true);
    resetForTesting();
    expect(isWarmedUp()).toBe(false);
  });
});
