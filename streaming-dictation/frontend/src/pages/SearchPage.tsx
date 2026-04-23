import { useState, useEffect, useRef } from 'react'
import { api, type Transcript } from '../api/client'
import { TranscriptCard } from '../components/TranscriptCard'
import { LoadingSpinner } from '../components/LoadingSpinner'

const DEBOUNCE_MS = 400

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Transcript[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setSearched(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.searchTranscripts(trimmed)
        setResults(data.transcripts)
        setSearched(true)
      } catch {
        setResults([])
        setSearched(true)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const handleClear = () => {
    setQuery('')
    setResults([])
    setSearched(false)
    inputRef.current?.focus()
  }

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">Search</h2>

      {/* Search input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search your transcripts…"
          className="w-full px-4 py-3 pr-20 rounded-xl border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base min-h-[48px]"
          autoComplete="off"
          autoCapitalize="off"
          aria-label="Search transcripts"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && <LoadingSpinner size="sm" />}
          {query && !loading && (
            <button
              onClick={handleClear}
              className="text-slate-400 hover:text-slate-600 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Empty query hint */}
      {!query && (
        <p className="text-sm text-slate-400 text-center pt-8">
          Type to search your recent transcripts
        </p>
      )}

      {/* No results */}
      {searched && !loading && results.length === 0 && (
        <div className="text-center py-12 text-slate-400" role="status">
          <p className="font-medium text-slate-500">No results</p>
          <p className="text-sm mt-1">Try different keywords</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3" aria-live="polite" aria-label={`${results.length} result${results.length !== 1 ? 's' : ''}`}>
          <p className="text-xs text-slate-400">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </p>
          {results.map(t => (
            <TranscriptCard key={t.id} transcript={t} />
          ))}
        </div>
      )}
    </div>
  )
}
