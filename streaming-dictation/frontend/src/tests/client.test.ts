import { describe, it, expect, afterEach, vi } from 'vitest'
import { api } from '../api/client'

function mockFetch(status: number, body: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
}

describe('api client error formatting', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('includes the requestId in a 500 error message', async () => {
    mockFetch(500, { error: 'Internal server error', requestId: 'req-abc-123' })
    await expect(api.warmup()).rejects.toThrow(/req-abc-123/)
  })

  it('falls back to HTTP <status> when no error body is present', async () => {
    mockFetch(500, {})
    await expect(api.warmup()).rejects.toThrow('HTTP 500')
  })
})
