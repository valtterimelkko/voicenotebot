export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-10 w-10' : 'h-6 w-6'
  return (
    <div
      className={`${sz} animate-spin rounded-full border-2 border-slate-300 border-t-slate-700`}
      role="status"
      aria-label="Loading"
    />
  )
}
