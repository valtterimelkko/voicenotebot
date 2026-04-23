import { create } from 'zustand'
import type { Settings } from '../api/client'

interface SettingsState {
  settings: Settings | null
  setSettings: (s: Settings) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  setSettings: (s) => set({ settings: s })
}))
