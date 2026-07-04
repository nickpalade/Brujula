// VoiceInput — Spanish voice-to-text for field reports (agent VOICE).
//
// Fills the mic stub FIELD-UI left. Web Speech API primary (es-VE → es-ES fallback,
// zero deps, works in Chrome on Android). Gradium STT is an optional upgrade behind
// the same interface (see gradium.js) — non-blocking, off unless a key is provided.
//
// Contract kept for the drop-in replacement:
//   props.onTranscript(text)  — called with FINALIZED recognized text; ReportForm
//     appends it into the textarea. Interim words are shown in a local live preview,
//     never pushed to onTranscript, so the textarea never accumulates half-words.
//   props.disabled?           — hard-disable from the parent.
//
// Honest offline UX: Web Speech needs internet on most mobile browsers. When offline
// (or on unsupported browsers) the mic is disabled with a Spanish tooltip + hint
// bubble rather than failing silently. Typing always works, fully offline.

import { useState } from 'react'
import './voice.css'
import { useSpeechRecognition } from './useSpeechRecognition.js'

function VoiceInput({ onTranscript, disabled = false }) {
  const [showHint, setShowHint] = useState(false)
  const { supported, listening, interim, error, online, toggle } =
    useSpeechRecognition({ onFinal: onTranscript })

  // Unsupported browser (e.g. Firefox, some in-app webviews): hide gracefully.
  // Render a disabled affordance so the report layout stays put, with an honest tooltip.
  if (!supported) {
    return (
      <button
        type="button"
        className="mic-btn"
        disabled
        title="La entrada de voz no está disponible en este navegador. Usa Chrome, o escribe el reporte."
        aria-label="Entrada de voz no disponible en este navegador"
      >
        🎤
      </button>
    )
  }

  const offline = !online
  const micDisabled = disabled || offline

  const hintText = (() => {
    if (offline) return 'La voz necesita conexión. Sin internet — escribe el reporte.'
    if (error === 'not-allowed')
      return 'Permiso de micrófono denegado. Actívalo en el navegador.'
    if (error === 'network')
      return 'Sin conexión para el reconocimiento de voz. Escribe el reporte.'
    if (error === 'no-speech') return 'No se escuchó nada. Intenta de nuevo.'
    return null
  })()

  const title = offline
    ? 'La voz necesita internet (no disponible sin conexión)'
    : listening
      ? 'Detener grabación'
      : 'Hablar reporte (español)'

  const handleClick = () => {
    if (micDisabled) {
      // Explain why it's unavailable instead of doing nothing silently.
      setShowHint(true)
      setTimeout(() => setShowHint(false), 3200)
      return
    }
    toggle()
  }

  const showLive = listening
  const showHintBubble = !listening && (showHint || (!!hintText && error != null))

  return (
    <>
      {showLive && (
        <div className="voice-live" role="status" aria-live="polite">
          <div className="voice-live-label">
            <span className="rec-dot" />
            Grabando…
          </div>
          <div className={`voice-live-text${interim ? '' : ' placeholder'}`}>
            {interim || 'Habla ahora — el texto aparecerá aquí.'}
          </div>
        </div>
      )}

      {showHintBubble && hintText && (
        <div className="voice-hint" role="status" aria-live="polite">
          {hintText}
        </div>
      )}

      <button
        type="button"
        className={`mic-btn${listening ? ' recording' : ''}${offline ? ' offline' : ''}`}
        // aria-disabled (not disabled) when offline so the tap can still explain why.
        aria-disabled={micDisabled}
        aria-pressed={listening}
        title={title}
        aria-label={title}
        onClick={handleClick}
      >
        {listening ? '⏺' : '🎤'}
      </button>
    </>
  )
}

export default VoiceInput
