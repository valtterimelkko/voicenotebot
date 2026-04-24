import { useEffect, useRef, useCallback } from 'react'

export function useVisibilityPolling(callback: () => void, intervalMs: number) {
  const savedCallback = useRef(callback)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  const startPolling = useCallback(() => {
    if (timerRef.current) return
    timerRef.current = setInterval(() => savedCallback.current(), intervalMs)
  }, [intervalMs])

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        savedCallback.current()
        startPolling()
      } else {
        stopPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [startPolling, stopPolling])
}
