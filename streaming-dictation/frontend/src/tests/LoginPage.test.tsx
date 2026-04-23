import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from '../pages/LoginPage'
import { useAuthStore } from '../store/authStore'

// Mock api
vi.mock('../api/client', () => ({
  api: {
    login: vi.fn(),
    checkSession: vi.fn().mockResolvedValue({ authenticated: false })
  }
}))

import { api } from '../api/client'

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ authenticated: null })
  })

  it('renders login form with password field and submit button', () => {
    renderLogin()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('submit button is disabled when password is empty', () => {
    renderLogin()
    const btn = screen.getByRole('button', { name: /sign in/i })
    expect(btn).toBeDisabled()
  })

  it('shows error on failed login', async () => {
    vi.mocked(api.login).mockRejectedValueOnce(new Error('Invalid credentials'))
    renderLogin()
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials')
    })
  })

  it('calls api.login with entered password', async () => {
    vi.mocked(api.login).mockResolvedValueOnce({ ok: true })
    renderLogin()
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(api.login).toHaveBeenCalledWith('secret123')
    })
  })
})
