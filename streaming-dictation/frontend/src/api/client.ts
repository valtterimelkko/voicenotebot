export interface Transcript {
  id: string
  created_at: string
  expires_at: string
  preview_text: string
  raw_text: string
  cleaned_text: string
  cleanup_model: string
  stt_model: string
  used_fallback: number
  duration_ms: number | null
  status: string
}

export interface Settings {
  default_cleanup_model: string
  retention_days: number
  stt_vocabulary: string
}

async function apiFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new Error((body.error as string) ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  // Auth
  checkSession: () => apiFetch('/auth/session') as Promise<{ authenticated: boolean }>,
  login: (password: string) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }) as Promise<{ ok: boolean }>,
  logout: () => apiFetch('/auth/logout', { method: 'POST' }) as Promise<{ ok: boolean }>,

  // Recordings
  warmup: () => apiFetch('/api/recordings/warmup', { method: 'POST' }) as Promise<{ ok: boolean }>,
  startRecording: () => apiFetch('/api/recordings/start', { method: 'POST' }) as Promise<{ id: string }>,
  streamChunk: (id: string, chunk: ArrayBuffer) =>
    fetch(`/api/recordings/${id}/stream`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk
    }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`) }),
  finishRecording: (id: string) =>
    apiFetch(`/api/recordings/${id}/finish`, { method: 'POST' }) as Promise<Transcript>,

  // Transcripts
  listTranscripts: () =>
    apiFetch('/api/transcripts') as Promise<{ transcripts: Transcript[] }>,
  searchTranscripts: (q: string) =>
    apiFetch(`/api/transcripts/search?q=${encodeURIComponent(q)}`) as Promise<{ transcripts: Transcript[] }>,
  getTranscript: (id: string) =>
    apiFetch(`/api/transcripts/${id}`) as Promise<Transcript>,

  // Settings
  getSettings: () => apiFetch('/api/settings') as Promise<Settings>,
  updateSettings: (data: Partial<Settings>) =>
    apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(data) }) as Promise<Settings>
}
