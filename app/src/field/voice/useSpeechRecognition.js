// Web Speech API wrapper for Spanish field reports (agent VOICE).
//
// Zero deps. Feature-detects SpeechRecognition; tries es-VE first and falls back
// to es-ES if the browser rejects the Venezuelan locale. Only FINAL segments are
// pushed to onFinal(); interim text is exposed via `interim` for a live preview so
// the report textarea (which appends) never accumulates half-recognized words.
//
// Honest offline handling: Web Speech streams audio to the browser vendor's cloud
// on most mobile browsers, so it needs internet. We track navigator.onLine and
// treat a `network` recognition error as an offline condition — the UI disables the
// mic and explains, rather than failing silently.

import { useCallback, useEffect, useRef, useState } from 'react'

const PRIMARY_LANG = 'es-VE'
const FALLBACK_LANG = 'es-ES'

function getRecognitionCtor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function useSpeechRecognition({ onFinal } = {}) {
  const Ctor = getRecognitionCtor()
  const supported = !!Ctor

  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  const recognitionRef = useRef(null)
  const langRef = useRef(PRIMARY_LANG)
  // Guards an intentional restart when we retry with the fallback locale, so the
  // `onend` handler doesn't clear `listening` mid-retry.
  const retryingRef = useRef(false)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const buildRecognition = useCallback(
    (lang) => {
      const rec = new Ctor()
      rec.lang = lang
      rec.continuous = true
      rec.interimResults = true
      rec.maxAlternatives = 1

      rec.onresult = (event) => {
        let interimText = ''
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]
          const transcript = result[0]?.transcript ?? ''
          if (result.isFinal) {
            const finalText = transcript.trim()
            if (finalText && onFinalRef.current) onFinalRef.current(finalText)
          } else {
            interimText += transcript
          }
        }
        setInterim(interimText)
      }

      rec.onerror = (event) => {
        const err = event.error
        // es-VE unsupported on this engine → transparently retry with es-ES.
        if (
          (err === 'language-not-supported' || err === 'bad-grammar') &&
          langRef.current === PRIMARY_LANG
        ) {
          langRef.current = FALLBACK_LANG
          retryingRef.current = true
          try {
            rec.stop()
          } catch {
            /* no-op */
          }
          return
        }
        if (err === 'network') {
          setOnline(false)
          setError('network')
        } else if (err === 'not-allowed' || err === 'service-not-allowed') {
          setError('not-allowed')
        } else if (err === 'no-speech') {
          setError('no-speech')
        } else if (err !== 'aborted') {
          setError(err || 'unknown')
        }
      }

      rec.onend = () => {
        setInterim('')
        if (retryingRef.current) {
          // Restart with the fallback locale.
          retryingRef.current = false
          const next = buildRecognition(langRef.current)
          recognitionRef.current = next
          try {
            next.start()
            setListening(true)
            return
          } catch {
            setListening(false)
            return
          }
        }
        setListening(false)
      }

      return rec
    },
    [Ctor],
  )

  const start = useCallback(() => {
    if (!supported) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setOnline(false)
      setError('network')
      return
    }
    if (recognitionRef.current && listening) return

    setError(null)
    setInterim('')
    langRef.current = PRIMARY_LANG
    retryingRef.current = false

    const rec = buildRecognition(PRIMARY_LANG)
    recognitionRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      // start() throws if called while already running — reset defensively.
      setListening(false)
    }
  }, [supported, listening, buildRecognition])

  const stop = useCallback(() => {
    const rec = recognitionRef.current
    if (!rec) return
    retryingRef.current = false
    try {
      rec.stop()
    } catch {
      /* no-op */
    }
    setListening(false)
  }, [])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  useEffect(
    () => () => {
      const rec = recognitionRef.current
      if (rec) {
        retryingRef.current = false
        try {
          rec.abort()
        } catch {
          /* no-op */
        }
      }
    },
    [],
  )

  return { supported, listening, interim, error, online, start, stop, toggle }
}
