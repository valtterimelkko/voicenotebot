import { useState, useRef, useCallback, useEffect } from 'react'
import { api, type Transcript } from '../api/client'
import { RecordButton } from '../components/RecordButton'
import { TranscriptCard } from '../components/TranscriptCard'
import { useSettingsStore } from '../store/settingsStore'

type RecordState = 'idle' | 'recording' | 'processing' | 'error'

const CHUNK_INTERVAL_MS = 1000

function getMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
  ]
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? ''
}

export function RecordPage() {
  const [recordState, setRecordState] = useState<RecordState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [lastTranscript, setLastTranscript] = useState<Transcript | null>(null)
  const settings = useSettingsStore(s => s.settings)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingIdRef = useRef<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const pendingChunksRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    api.getSettings()
      .then(s => useSettingsStore.getState().setSettings(s))
      .catch(() => { /* non-fatal */ })
    api.warmup().catch(() => { /* non-fatal */ })
  }, [])

  const startRecording = useCallback(async () => {
    setErrorMessage('')

    // Check mic availability
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Your browser does not support microphone access. Please use a modern browser.')
      setRecordState('error')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('denied')) {
        setErrorMessage('Microphone permission denied. Please allow microphone access in your browser settings and try again.')
      } else if (msg.includes('NotFound') || msg.includes('Requested device not found')) {
        setErrorMessage('No microphone found. Please connect a microphone and try again.')
      } else {
        setErrorMessage(`Microphone error: ${msg}`)
      }
      setRecordState('error')
      return
    }

    streamRef.current = stream

    let id: string
    try {
      const result = await api.startRecording()
      id = result.id
    } catch (err: unknown) {
      stream.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start recording session')
      setRecordState('error')
      return
    }

    recordingIdRef.current = id
    pendingChunksRef.current = Promise.resolve()

    const mimeType = getMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0 && recordingIdRef.current) {
        const currentId = recordingIdRef.current
        // Chain chunk uploads to preserve ordering
        pendingChunksRef.current = pendingChunksRef.current.then(async () => {
          const buf = await e.data.arrayBuffer()
          await api.streamChunk(currentId, buf).catch(console.warn)
        })
      }
    }

    recorder.start(CHUNK_INTERVAL_MS)
    setRecordState('recording')
  }, [])

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    const id = recordingIdRef.current
    if (!recorder || !id) return

    setRecordState('processing')

    // Stop recorder and wait for final ondataavailable
    await new Promise<void>(resolve => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.stop()
    })

    // Stop mic tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }

    // Wait for all in-flight chunk uploads
    await pendingChunksRef.current

    mediaRecorderRef.current = null
    recordingIdRef.current = null

    try {
      const transcript = await api.finishRecording(id)
      setLastTranscript(transcript)
      setRecordState('idle')
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to process recording')
      setRecordState('error')
    }
  }, [])

  const handleToggle = useCallback(() => {
    if (recordState === 'idle' || recordState === 'error') {
      void startRecording()
    } else if (recordState === 'recording') {
      void stopRecording()
    }
  }, [recordState, startRecording, stopRecording])

  return (
    <div className="px-4 py-10 flex flex-col items-center gap-8 max-w-lg mx-auto">
      {settings && (
        <p className="text-xs text-slate-400 self-start">
          Cleanup model: <span className="font-semibold text-slate-600">{settings.default_cleanup_model}</span>
        </p>
      )}

      <RecordButton
        state={recordState}
        onToggle={handleToggle}
        errorMessage={errorMessage}
      />

      {recordState === 'processing' && (
        <p className="text-slate-500 text-sm text-center">
          Transcribing and cleaning up your recording…
        </p>
      )}

      {recordState === 'idle' && !lastTranscript && (
        <p className="text-slate-400 text-xs text-center max-w-xs">
          Tap the button to start recording. Tap again to stop and get your transcript.
        </p>
      )}

      {lastTranscript && (
        <div className="w-full space-y-2">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
            Latest transcript
          </p>
          <TranscriptCard transcript={lastTranscript} />
        </div>
      )}
    </div>
  )
}
