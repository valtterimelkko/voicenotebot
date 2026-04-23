type RecordState = 'idle' | 'recording' | 'processing' | 'error'

interface RecordButtonProps {
  state: RecordState
  onToggle: () => void
  errorMessage?: string
}

const stateConfig = {
  idle: {
    bg: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
    label: 'Start recording',
    indicator: (
      <div className="w-10 h-10 rounded-full bg-white/90" aria-hidden="true" />
    ),
    hint: 'Tap to record'
  },
  recording: {
    bg: 'bg-red-500 hover:bg-red-600 active:bg-red-700',
    label: 'Stop recording',
    indicator: (
      <div className="w-8 h-8 rounded-md bg-white/90 animate-pulse" aria-hidden="true" />
    ),
    hint: 'Recording… tap to stop'
  },
  processing: {
    bg: 'bg-slate-400 cursor-not-allowed',
    label: 'Processing recording',
    indicator: (
      <div className="w-9 h-9 rounded-full border-4 border-white/40 border-t-white animate-spin" aria-hidden="true" />
    ),
    hint: 'Processing…'
  },
  error: {
    bg: 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700',
    label: 'Retry recording',
    indicator: (
      <div className="w-10 h-10 flex items-center justify-center text-white text-3xl font-bold" aria-hidden="true">!</div>
    ),
    hint: 'Tap to retry'
  }
}

export function RecordButton({ state, onToggle, errorMessage }: RecordButtonProps) {
  const cfg = stateConfig[state]
  const isDisabled = state === 'processing'

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={onToggle}
        disabled={isDisabled}
        className={`w-40 h-40 rounded-full flex flex-col items-center justify-center shadow-lg transition-all duration-150 select-none touch-manipulation ${
          isDisabled ? '' : 'active:scale-95'
        } ${cfg.bg}`}
        aria-label={cfg.label}
        aria-pressed={state === 'recording'}
      >
        {cfg.indicator}
        <span className="mt-3 text-white text-sm font-medium text-center px-2">
          {cfg.hint}
        </span>
      </button>
      {state === 'error' && errorMessage && (
        <p className="text-red-600 text-sm text-center max-w-xs px-4" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
