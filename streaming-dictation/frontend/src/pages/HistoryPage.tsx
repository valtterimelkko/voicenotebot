import { useEffect, useState, useCallback } from 'react'
import { api, type Transcript } from '../api/client'
import { TranscriptCard } from '../components/TranscriptCard'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useVisibilityPolling } from '../hooks/useVisibilityPolling'

export function HistoryPage() {
  const [transcripts, setTranscripts] = useState<Transcript[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await api.listTranscripts()
      setTranscripts(data.transcripts)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load transcripts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useVisibilityPolling(load, 10_000)

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">History</h2>
        <button
          onClick={() => { setLoading(true); void load() }}
          disabled={loading}
          className="text-sm text-blue-600 hover:text-blue-800 min-h-[44px] px-2 disabled:text-slate-400 transition-colors"
          aria-label="Refresh history"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-12" aria-live="polite">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm" role="alert">
          <span>{error}</span>
          <button onClick={() => void load()} className="ml-2 underline font-medium">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && transcripts.length === 0 && (
        <div className="text-center py-16 text-slate-400" aria-live="polite">
          <p className="text-4xl mb-3" aria-hidden="true">🎙</p>
          <p className="font-medium text-slate-500">No transcripts yet</p>
          <p className="text-sm mt-1">Record something to see it here</p>
        </div>
      )}

      {!loading && transcripts.length > 0 && (
        <div className="space-y-3" aria-live="polite">
          {transcripts.map(t => (
            <TranscriptCard key={t.id} transcript={t} />
          ))}
        </div>
      )}
    </div>
  )
}
