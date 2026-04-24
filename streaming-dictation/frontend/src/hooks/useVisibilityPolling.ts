import { useEffect } from 'react'

export function useVisibilityPolling(callback: () => void, intervalMs: number) {
  useEffect(() => {
    let stopped = false

    const id = setInterval(() => {
      if (!stopped) callback()
    }, intervalMs)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        stopped = false
        callback()
      } else {
        stopped = true
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stopped = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [callback, intervalMs])
}
