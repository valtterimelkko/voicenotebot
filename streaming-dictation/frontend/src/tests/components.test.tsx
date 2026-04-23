import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RecordButton } from '../components/RecordButton'
import { CopyButton } from '../components/CopyButton'

describe('RecordButton', () => {
  it('shows "Tap to record" hint in idle state', () => {
    const onToggle = vi.fn()
    render(<RecordButton state="idle" onToggle={onToggle} />)
    expect(screen.getByText(/tap to record/i)).toBeInTheDocument()
  })

  it('shows "Recording" hint in recording state', () => {
    const onToggle = vi.fn()
    render(<RecordButton state="recording" onToggle={onToggle} />)
    expect(screen.getByText(/recording/i)).toBeInTheDocument()
  })

  it('shows "Processing" hint in processing state', () => {
    const onToggle = vi.fn()
    render(<RecordButton state="processing" onToggle={onToggle} />)
    expect(screen.getByText(/processing/i)).toBeInTheDocument()
  })

  it('is disabled during processing state', () => {
    const onToggle = vi.fn()
    render(<RecordButton state="processing" onToggle={onToggle} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('calls onToggle when clicked in idle state', () => {
    const onToggle = vi.fn()
    render(<RecordButton state="idle" onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('shows error message in error state', () => {
    const onToggle = vi.fn()
    render(<RecordButton state="error" onToggle={onToggle} errorMessage="Mic denied" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Mic denied')
  })

  it('does not show error message when in idle state', () => {
    const onToggle = vi.fn()
    render(<RecordButton state="idle" onToggle={onToggle} errorMessage="Mic denied" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('CopyButton', () => {
  it('renders with "Copy" label', () => {
    render(<CopyButton text="hello world" />)
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })

  it('shows "Copied" feedback after click', async () => {
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    render(<CopyButton text="hello world" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(screen.getByRole('button')).toHaveTextContent(/copied/i)
  })
})
