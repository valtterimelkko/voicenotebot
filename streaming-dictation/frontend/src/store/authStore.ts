import { create } from 'zustand'

interface AuthState {
  authenticated: boolean | null
  setAuthenticated: (v: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  authenticated: null,
  setAuthenticated: (v) => set({ authenticated: v })
}))
