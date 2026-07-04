// Field assistant — "Preguntar": any responder asks the hub's Gemma a plain
// question; answers are grounded server-side in the live board + the offline
// protocol KB (POST /api/ask). Flat exchange log, no chat bubbles. The
// compass needle in the header spins while the model thinks (tracked POST).

import { useEffect, useRef, useState } from 'react'
import { api } from '../shared/api.js'
import { useI18n } from '../shared/i18n.jsx'

const HISTORY_KEY = 'brujula.field.ask.v1'
const MAX_HISTORY = 30

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(items) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-MAX_HISTORY)))
  } catch {
    /* quota / private mode — history lives in memory this session */
  }
}

function AskPanel({ deviceId }) {
  const { lang, t } = useI18n()
  const [items, setItems] = useState(loadHistory)
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const endRef = useRef(null)

  useEffect(() => {
    saveHistory(items)
  }, [items])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [items, pending])

  const send = async () => {
    const q = question.trim()
    if (!q || pending) return
    setQuestion('')
    setError(null)
    setPending(true)
    setItems((prev) => [...prev, { kind: 'q', text: q, at: new Date().toISOString() }])
    try {
      const data = await api.ask({ question: q, device_id: deviceId, lang })
      setItems((prev) => [...prev, { kind: 'a', text: data.answer, at: data.asked_at }])
    } catch (err) {
      setError(err.message || t('ask.error'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="ask">
      <p className="ask-hint">{t('ask.hint')}</p>

      <div className="ask-log" aria-live="polite">
        {items.length === 0 && !pending && (
          <div className="empty">{t('ask.empty')}</div>
        )}
        {items.map((it, i) => (
          <div key={`${it.at}-${i}`} className={`ask-line ask-line--${it.kind}`}>
            <span className="ask-who">{it.kind === 'q' ? t('ask.you') : 'BRÚJULA'}</span>
            <p className="ask-text">{it.text}</p>
          </div>
        ))}
        {pending && (
          <div className="ask-line ask-line--a">
            <span className="ask-who">BRÚJULA</span>
            <p className="ask-text ask-text--pending">{t('ask.thinking')}</p>
          </div>
        )}
        {error && <div className="ask-error">{error}</div>}
        <div ref={endRef} />
      </div>

      <div className="ask-composer">
        <textarea
          className="ask-input"
          rows={2}
          placeholder={t('ask.placeholder')}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button
          type="button"
          className="send-btn ask-send"
          disabled={!question.trim() || pending}
          onClick={send}
        >
          {pending ? t('ask.thinkingShort') : t('ask.send')}
        </button>
      </div>

      <p className="ask-disclaimer">{t('ask.disclaimer')}</p>
    </div>
  )
}

export default AskPanel
