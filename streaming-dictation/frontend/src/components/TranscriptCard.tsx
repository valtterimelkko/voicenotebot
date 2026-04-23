import { useState } from 'react'
import type { Transcript } from '../api/client'
import { CopyButton } from './CopyButton'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(ms: number | null): string | null {
  if (!ms) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export function TranscriptCard({ transcript }: { transcript: Transcript }) {
  const [expanded, setExpanded] = useState(false)
  const text = transcript.cleaned_text || transcript.raw_text || ''
  const isLong = text.length > 220

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Meta row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {formatDate(transcript.created_at)}
            </span>
            {transcript.used_fallback === 1 && (
              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                fallback
              </span>
            )}
            {transcript.cleanup_model && (
              <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                {transcript.cleanup_model}
              </span>
            )}
            {formatDuration(transcript.duration_ms) && (
              <span className="text-xs text-slate-400">
                {formatDuration(transcript.duration_ms)}
              </span>
            )}
          </div>
          {/* Text */}
          <p className="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {expanded || !isLong ? text : text.slice(0, 220) + '…'}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-600 hover:text-blue-800 mt-1.5 min-h-[36px] flex items-center"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
        {/* Copy button */}
        <div className="flex-shrink-0 pt-1">
          <CopyButton text={text} />
        </div>
      </div>
    </div>
  )
}
