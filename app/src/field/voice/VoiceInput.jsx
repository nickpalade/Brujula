// VoiceInput — phone capture, laptop-local transcription, phone confirmation.
// The phone records a short audio clip, posts it to the hub laptop, then asks
// the responder to confirm or edit before the text is appended to the report.

import { useState } from 'react'
import './voice.css'
import { useHubTranscription } from './useHubTranscription.js'
import { useI18n } from '../../shared/i18n.jsx'
import Icon from '../../shared/Icon.jsx'

function VoiceInput({ onTranscript, disabled = false }) {
  const { lang, t } = useI18n()
  const [showHint, setShowHint] = useState(false)
  const [draft, setDraft] = useState('')
  const { supported, recording, transcribing, error, toggle } = useHubTranscription({
    lang,
    onCandidate: setDraft,
  })

  if (!supported) {
    return (
      <button
        type="button"
        className="mic-btn"
        disabled
        title={t('voice.unsupported')}
        aria-label={t('voice.unsupported')}
      >
        <Icon name="mic" />
      </button>
    )
  }

  const busy = recording || transcribing
  const micDisabled = disabled || transcribing || !!draft

  const hintText = (() => {
    if (error === 'not-allowed') return t('voice.notAllowed')
    if (error === 'network') return t('voice.network')
    if (error === 'empty') return t('voice.noSpeech')
    if (error === 'failed') return t('voice.failed')
    return null
  })()

  const title = recording ? t('voice.titleStop') : t('voice.titleStart')

  const handleClick = () => {
    if (micDisabled) {
      // Explain why it's unavailable instead of doing nothing silently.
      setShowHint(true)
      setTimeout(() => setShowHint(false), 3200)
      return
    }
    toggle()
  }

  const confirmDraft = () => {
    const text = draft.trim()
    if (text) onTranscript(text)
    setDraft('')
  }

  const showLive = recording || transcribing
  const showHintBubble = !busy && !draft && (showHint || (!!hintText && error != null))

  return (
    <>
      {showLive && (
        <div className="voice-live" role="status" aria-live="polite">
          <div className="voice-live-label">
            <span className="rec-dot" />
            {recording ? t('voice.recording') : t('voice.transcribing')}
          </div>
          <div className="voice-live-text placeholder">
            {recording ? t('voice.speakNow') : t('voice.localModel')}
          </div>
        </div>
      )}

      {draft && (
        <div className="voice-review" role="dialog" aria-label={t('voice.reviewTitle')}>
          <div className="voice-review-title">{t('voice.reviewTitle')}</div>
          <textarea
            className="voice-review-text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t('voice.reviewLabel')}
          />
          <div className="voice-review-actions">
            <button type="button" className="voice-review-secondary" onClick={() => setDraft('')}>
              {t('voice.retry')}
            </button>
            <button type="button" className="voice-review-primary" onClick={confirmDraft}>
              {t('voice.confirm')}
            </button>
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
        className={`mic-btn${recording ? ' recording' : ''}${transcribing ? ' recording' : ''}`}
        aria-disabled={micDisabled}
        aria-pressed={recording}
        title={title}
        aria-label={title}
        onClick={handleClick}
      >
        <Icon name="mic" />
      </button>
    </>
  )
}

export default VoiceInput
