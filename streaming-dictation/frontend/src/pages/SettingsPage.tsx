import { useEffect, useState } from 'react'
import { api, type Settings } from '../api/client'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useSettingsStore } from '../store/settingsStore'

const CLEANUP_MODELS = [
  { value: 'kimi', label: 'Kimi', description: 'Moonshot AI — good multilingual cleanup' },
  { value: 'gpt-5-nano', label: 'gpt-5-nano', description: 'OpenAI — fast and cost-effective' }
] as const

export function SettingsPage() {
  const [settings, setSettingsLocal] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const setStore = useSettingsStore(s => s.setSettings)

  useEffect(() => {
    api.getSettings()
      .then(s => {
        setSettingsLocal(s)
        setStore(s)
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [setStore])

  const handleModelChange = async (model: string) => {
    if (!settings || saving) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const updated = await api.updateSettings({ default_cleanup_model: model })
      setSettingsLocal(updated)
      setStore(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16" aria-live="polite">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
      <h2 className="text-lg font-semibold text-slate-800">Settings</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Cleanup model selector */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Cleanup model</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Which AI model cleans up raw transcripts
          </p>
        </div>

        <fieldset disabled={saving} className="space-y-2">
          <legend className="sr-only">Choose cleanup model</legend>
          {CLEANUP_MODELS.map(({ value, label, description }) => {
            const isSelected = settings?.default_cleanup_model === value
            return (
              <label
                key={value}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors min-h-[56px] ${
                  isSelected
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="cleanup_model"
                  value={value}
                  checked={isSelected}
                  onChange={() => void handleModelChange(value)}
                  className="mt-0.5 text-blue-600 accent-blue-600"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{label}</p>
                  <p className="text-xs text-slate-400">{description}</p>
                </div>
              </label>
            )
          })}
        </fieldset>

        <div className="h-5 flex items-center">
          {saving && (
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <LoadingSpinner size="sm" /> Saving…
            </span>
          )}
          {saved && !saving && (
            <span className="text-xs text-green-600 font-medium">✓ Saved</span>
          )}
        </div>
      </section>

      {/* Retention info */}
      {settings && (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Retention policy</h3>
          <p className="text-sm text-slate-600">
            Transcripts are kept for{' '}
            <span className="font-semibold text-slate-800">{settings.retention_days} days</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Older recordings are automatically deleted to save storage.
          </p>
        </section>
      )}
    </div>
  )
}
