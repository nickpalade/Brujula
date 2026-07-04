import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../shared/api.js'

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.split(',').pop() : result)
    }
    reader.onerror = () => reject(reader.error || new Error('could not read audio'))
    reader.readAsDataURL(blob)
  })
}

export function useHubTranscription({ lang = 'es', onCandidate } = {}) {
  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'

  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState(null)

  const chunksRef = useRef([])
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const onCandidateRef = useRef(onCandidate)
  onCandidateRef.current = onCandidate

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const transcribeBlob = useCallback(
    async (blob) => {
      setTranscribing(true)
      setError(null)
      try {
        const audio_base64 = await blobToBase64(blob)
        const result = await api.transcribeVoice({
          audio_base64,
          audio_mime: blob.type || 'audio/webm',
          lang,
        })
        const text = result?.text?.trim()
        if (!text) {
          setError('empty')
          return
        }
        onCandidateRef.current?.(text)
      } catch (err) {
        setError(err?.message === 'hub unreachable' ? 'network' : 'failed')
      } finally {
        setTranscribing(false)
      }
    },
    [lang],
  )

  const start = useCallback(async () => {
    if (!supported || recording || transcribing) return
    setError(null)
    chunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => setError('failed')
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        })
        chunksRef.current = []
        cleanupStream()
        setRecording(false)
        if (blob.size > 0) transcribeBlob(blob)
        else setError('empty')
      }
      recorder.start()
      setRecording(true)
    } catch (err) {
      cleanupStream()
      setError(err?.name === 'NotAllowedError' ? 'not-allowed' : 'failed')
      setRecording(false)
    }
  }, [cleanupStream, recording, supported, transcribeBlob, transcribing])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
  }, [])

  const toggle = useCallback(() => {
    if (recording) stop()
    else start()
  }, [recording, start, stop])

  useEffect(
    () => () => {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          /* no-op */
        }
      }
      cleanupStream()
    },
    [cleanupStream],
  )

  return { supported, recording, transcribing, error, start, stop, toggle }
}
