import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HistoryPage } from '../pages/HistoryPage'
import { SearchPage } from '../pages/SearchPage'
import { SettingsPage } from '../pages/SettingsPage'
import { useVisibilityPolling } from '../hooks/useVisibilityPolling'
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

  it('refreshes when the refresh button is clicked', async () => {
    vi.mocked(api.listTranscripts)
      .mockResolvedValueOnce({ transcripts: [] })
      .mockResolvedValueOnce({ transcripts: [mockTranscript] })

    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText(/Refresh/i)).toBeInTheDocument()
    })

    await act(async () => {
      screen.getByText(/Refresh/i).click()
    })

    await waitFor(() => {
      expect(screen.getByText(/Hello world cleaned text/)).toBeInTheDocument()
    })
  })
})

describe('HistoryPage polling', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('calls listTranscripts on polling interval', async () => {
    let resolveFirst: () => void
    const firstPromise = new Promise<{ transcripts: Transcript[] }>((resolve) => {
      resolveFirst = () => resolve({ transcripts: [] })
    })

    vi.mocked(api.listTranscripts)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({ transcripts: [mockTranscript] })

    render(<MemoryRouter><HistoryPage /></MemoryRouter>)

    await act(async () => { resolveFirst!() })

    await act(async () => { vi.advanceTimersByTime(10_000) })

    expect(api.listTranscripts).toHaveBeenCalledTimes(2)
  })
})

describe('useVisibilityPolling', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('calls callback on interval', async () => {
    const callback = vi.fn()

    function TestComponent() {
      useVisibilityPolling(callback, 5_000)
      return <div>test</div>
    }

    render(<TestComponent />)

    expect(callback).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(5_000) })
    expect(callback).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(5_000) })
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('stops polling when document becomes hidden', async () => {
    const callback = vi.fn()

    function TestComponent() {
      useVisibilityPolling(callback, 5_000)
      return <div>test</div>
    }

    render(<TestComponent />)

    await act(async () => { vi.advanceTimersByTime(5_000) })
    const callsBefore = callback.mock.calls.length
    expect(callsBefore).toBeGreaterThanOrEqual(1)

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(callback.mock.calls.length).toBe(callsBefore)
  })

  it('resumes polling and calls callback immediately when document becomes visible', async () => {
    const callback = vi.fn()

    function TestComponent() {
      useVisibilityPolling(callback, 5_000)
      return <div>test</div>
    }

    render(<TestComponent />)

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(callback).not.toHaveBeenCalled()

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(callback).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(5_000) })
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('cleans up interval and listener on unmount', async () => {
    const callback = vi.fn()

    function TestComponent() {
      useVisibilityPolling(callback, 5_000)
      return <div>test</div>
    }

    const { unmount } = render(<TestComponent />)

    unmount()

    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(callback).not.toHaveBeenCalled()
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
