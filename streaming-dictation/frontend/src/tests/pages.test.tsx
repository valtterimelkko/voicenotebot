import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HistoryPage } from '../pages/HistoryPage'
import { SearchPage } from '../pages/SearchPage'
import { SettingsPage } from '../pages/SettingsPage'
import type { Transcript, Settings } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    listTranscripts: vi.fn(),
    searchTranscripts: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn()
  }
}))

import { api } from '../api/client'

const mockTranscript: Transcript = {
  id: 'test-id-1',
  created_at: '2024-01-15T10:30:00Z',
  expires_at: '2024-01-29T10:30:00Z',
  preview_text: 'Hello world preview',
  raw_text: 'hello world raw',
  cleaned_text: 'Hello world cleaned text for testing purposes.',
  cleanup_model: 'kimi',
  stt_model: 'gpt-4o-mini-transcribe',
  used_fallback: 0,
  duration_ms: 3200,
  status: 'completed'
}

const mockSettings: Settings = {
  default_cleanup_model: 'kimi',
  retention_days: 14
}

describe('HistoryPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows loading spinner initially', () => {
    vi.mocked(api.listTranscripts).mockImplementation(() => new Promise(() => {}))
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
  })

  it('renders transcript cards after load', async () => {
    vi.mocked(api.listTranscripts).mockResolvedValueOnce({ transcripts: [mockTranscript] })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText(/Hello world cleaned text/)).toBeInTheDocument()
    })
  })

  it('shows empty state when no transcripts', async () => {
    vi.mocked(api.listTranscripts).mockResolvedValueOnce({ transcripts: [] })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText(/No transcripts yet/i)).toBeInTheDocument()
    })
  })

  it('shows copy button for each transcript', async () => {
    vi.mocked(api.listTranscripts).mockResolvedValueOnce({ transcripts: [mockTranscript] })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    })
  })

  it('shows fallback badge when used_fallback is 1', async () => {
    const fallbackTranscript = { ...mockTranscript, used_fallback: 1 }
    vi.mocked(api.listTranscripts).mockResolvedValueOnce({ transcripts: [fallbackTranscript] })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('fallback')).toBeInTheDocument()
    })
  })
})

describe('SearchPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows hint text before searching', () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    expect(screen.getByText(/Type to search/i)).toBeInTheDocument()
  })

  it('renders search input', () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    expect(screen.getByRole('searchbox', { name: /search/i })).toBeInTheDocument()
  })
})

describe('SettingsPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows both cleanup model options after load', async () => {
    vi.mocked(api.getSettings).mockResolvedValueOnce(mockSettings)
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByLabelText(/kimi/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/gpt-5-nano/i)).toBeInTheDocument()
    })
  })

  it('shows selected cleanup model as checked', async () => {
    vi.mocked(api.getSettings).mockResolvedValueOnce(mockSettings)
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    await waitFor(() => {
      const kimiRadio = screen.getByDisplayValue('kimi') as HTMLInputElement
      expect(kimiRadio.checked).toBe(true)
    })
  })

  it('shows retention days', async () => {
    vi.mocked(api.getSettings).mockResolvedValueOnce(mockSettings)
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText(/14 days/)).toBeInTheDocument()
    })
  })
})
