import { useEffect, useState } from 'react'
import { api, type Settings } from '../api/client'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useSettingsStore } from '../store/settingsStore'

const CLEANUP_MODELS = [
  { value: 'google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B A4B', description: 'via OpenRouter — highest fidelity in the B5 benchmark, fastest real cleanup' }
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

  const handleVocabularySave = async () => {
    if (!settings || saving) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const updated = await api.updateSettings({ stt_vocabulary: settings.stt_vocabulary })
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

      {/* What actually runs — sourced from backend code constants, not settings */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Currently running</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Reported by the backend from its own configuration
          </p>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Cleanup model</dt>
            <dd data-testid="effective-cleanup-model" className="font-medium text-slate-800 text-right">
              {settings?.effective_cleanup_model ?? '—'}
              {settings?.cleanup_provider && (
                <span className="ml-1.5 text-xs font-normal text-slate-400">
                  via {settings.cleanup_provider}
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Transcription model</dt>
            <dd data-testid="stt-model" className="font-medium text-slate-800 text-right">
              {settings?.stt_model ?? '—'}
              {settings?.stt_model === 'gpt-4o-mini-transcribe' && (
                <span
                  className="ml-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700"
                  title="OpenAI removes this model from the API on 2027-02-26; migration to gpt-transcribe is planned"
                >
                  retires 2027-02-26
                </span>
              )}
            </dd>
          </div>
        </dl>
      </section>

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

      {/* STT Vocabulary */}
      {settings && (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">STT vocabulary</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Words and phrases the transcriber should know. One per line.
            </p>
          </div>
          <textarea
            value={settings.stt_vocabulary}
            onChange={(e) => {
              setSettingsLocal({ ...settings, stt_vocabulary: e.target.value })
            }}
            disabled={saving}
            rows={5}
            className="w-full text-sm border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:opacity-50 resize-y"
            placeholder="Claude&#10;Anthropic&#10;Kubernetes&#10;..."
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {(settings.stt_vocabulary ?? '').length}/500 characters
            </p>
            <button
              onClick={() => void handleVocabularySave()}
              disabled={saving}
              className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Save vocabulary
            </button>
          </div>
        </section>
      )}

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
