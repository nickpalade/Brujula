import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import Icon from './Icon.jsx'
import { useBorderGlow } from './BorderGlow.jsx'
import './contextChat.css'

const EXAMPLES = {
  command: [
    'Which decision needs attention next?',
    'What resource can cover the unmatched incident?',
  ],
  field: [
    'What should I remember from the KB?',
    'Which resources can help nearby?',
  ],
}

const ACTION_LABEL = {
  update_incident: 'Edit situation node',
  create_incident: 'Add situation node',
  create_alert: 'Add alert node',
  update_resource: 'Edit resource node',
}

function describeAction(action) {
  const kv = (obj) =>
    Object.entries(obj || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k.replace(/_/g, ' ')} → ${v}`)
      .join(', ')
  switch (action.type) {
    case 'update_incident':
      return `${action.incident_id}: ${kv(action.patch)}`
    case 'create_incident':
      return `[${action.fields?.urgency}] ${action.fields?.category}${action.fields?.location ? ` @ ${action.fields.location}` : ''} — ${action.fields?.summary}`
    case 'create_alert':
      return `(${action.fields?.severity}) ${action.fields?.message}${action.fields?.zone ? ` — zone: ${action.fields.zone}` : ''}`
    case 'update_resource':
      return `${action.resource_id}: ${kv(action.patch)}`
    default:
      return ''
  }
}

function applyActionRequest(action, dataApi) {
  switch (action.type) {
    case 'update_incident':
      return dataApi.patchIncident(action.incident_id, action.patch)
    case 'create_incident':
      return dataApi.createIncident(action.fields)
    case 'create_alert':
      return dataApi.createAlert(action.fields)
    case 'update_resource':
      return dataApi.patchResource(action.resource_id, action.patch)
    default:
      return Promise.reject(new Error(`unknown action type: ${action.type}`))
  }
}

const COPY = {
  command: {
    ariaLabel: 'Decision Assistant',
    title: 'Ask Gemma',
    scope: 'Decisions + KB',
    welcome: 'Ask why a dispatch was proposed, what is still unmatched, or which protocol matters before confirming.',
    label: 'Ask Gemma about current decisions',
    placeholder: 'Ask about a proposal, gap, resource constraint, or protocol…',
    thinking: 'Checking current decisions…',
  },
  field: {
    ariaLabel: 'Context Chat',
    title: 'AI Chatbot',
    scope: 'Known resources + KB',
    welcome: 'Ask me anything about the current board, field reports, resources, missing persons, alerts, personnel or the response KB.',
    label: 'Ask anything from known resources or KB',
    placeholder: 'Ask a question about the situation, resources, reports or protocols…',
    thinking: 'Searching known resources…',
  },
}

// `dataApi` lets a host surface route applied actions through its own data
// layer (the command graph passes its dataSource so mock-mode applies land on
// the same in-memory board the graph renders). Defaults to the shared client.
function ContextChat({ station = 'command', className = '', dataApi = api }) {
  const copy = COPY[station] ?? COPY.command
  const glow = useBorderGlow()
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text: copy.welcome,
      sources: [],
    },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)
  const transcriptRef = useRef(null)

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!fullscreen) return undefined

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setFullscreen(false)
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [fullscreen])

  const ask = async (text = question) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return

    const userMessage = { id: `user-${Date.now()}`, role: 'user', text: trimmed, sources: [] }
    setMessages((prev) => [...prev, userMessage])
    setQuestion('')
    setBusy(true)
    setError(null)

    try {
      const answer = await dataApi.chatContext({ question: trimmed, station })
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: answer.answer,
          sources: Array.isArray(answer.sources) ? answer.sources : [],
          actions: Array.isArray(answer.proposed_actions)
            ? answer.proposed_actions.map((action) => ({ ...action, state: 'proposed', error: null }))
            : [],
        },
      ])
    } catch (err) {
      setError(err.message || 'chat failed')
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: 'I could not reach the context chat service. Try again when the hub is reachable.',
          sources: [],
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  const setActionState = (messageId, actionIndex, patch) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actions: message.actions.map((action, index) =>
                index === actionIndex ? { ...action, ...patch } : action,
              ),
            }
          : message,
      ),
    )
  }

  const applyAction = async (messageId, actionIndex, action) => {
    setActionState(messageId, actionIndex, { state: 'applying', error: null })
    try {
      await applyActionRequest(action, dataApi)
      setActionState(messageId, actionIndex, { state: 'applied' })
    } catch (err) {
      setActionState(messageId, actionIndex, {
        state: 'proposed',
        error: err.message || 'could not apply',
      })
    }
  }

  return (
    <section
      className={[
        'context-chat',
        `context-chat--${station}`,
        'border-glow-host',
        fullscreen && 'context-chat--fullscreen',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={copy.ariaLabel}
      onPointerMove={glow.onPointerMove}
      style={glow.style}
    >
      <span className="edge-light" aria-hidden="true" />
      <header className="context-chat__head">
        <span className="context-chat__title">
          <Icon name="feed" size={16} />
          {copy.title}
        </span>
        <div className="context-chat__head-actions">
          <span className="context-chat__scope">{copy.scope}</span>
          <button
            type="button"
            className="context-chat__fullscreen"
            aria-label={fullscreen ? 'Exit fullscreen chat' : 'Open fullscreen chat'}
            aria-pressed={fullscreen}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={() => setFullscreen((value) => !value)}
          >
            <Icon name={fullscreen ? 'collapse' : 'expand'} size={16} />
          </button>
        </div>
      </header>

      <div className="context-chat__messages" ref={transcriptRef} aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`context-chat__msg context-chat__msg--${message.role}`}>
            <div className="context-chat__role">{message.role === 'user' ? 'You' : 'Brujula'}</div>
            <p>{message.text}</p>
            {message.sources.length > 0 && (
              <div className="context-chat__sources" aria-label="Answer sources">
                {message.sources.map((source, index) => (
                  <span key={`${source.label}-${index}`} className="context-chat__source">
                    {source.label}
                  </span>
                ))}
              </div>
            )}
            {(message.actions ?? []).some((action) => action.state !== 'dismissed') && (
              <div className="context-chat__actions" aria-label="Proposed board actions">
                {message.actions.map((action, index) =>
                  action.state === 'dismissed' ? null : (
                    <div
                      key={`${message.id}-action-${index}`}
                      className="context-chat__action"
                      data-testid="chat-proposed-action"
                    >
                      <div className="context-chat__action-head">
                        <span className="context-chat__action-type">
                          {ACTION_LABEL[action.type] ?? action.type}
                        </span>
                        {action.state === 'applied' && (
                          <span className="context-chat__action-done">Applied</span>
                        )}
                      </div>
                      <p className="context-chat__action-desc">{describeAction(action)}</p>
                      {action.reason && <p className="context-chat__action-reason">{action.reason}</p>}
                      {action.error && (
                        <p className="context-chat__action-error" role="alert">
                          {action.error}
                        </p>
                      )}
                      {action.state !== 'applied' && (
                        <div className="context-chat__action-buttons">
                          <button
                            type="button"
                            className="context-chat__action-apply"
                            disabled={action.state === 'applying'}
                            onClick={() => applyAction(message.id, index, action)}
                          >
                            {action.state === 'applying' ? 'Applying…' : 'Apply'}
                          </button>
                          <button
                            type="button"
                            className="context-chat__action-dismiss"
                            disabled={action.state === 'applying'}
                            onClick={() => setActionState(message.id, index, { state: 'dismissed' })}
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  ),
                )}
              </div>
            )}
          </article>
        ))}
        {busy && (
          <div className="context-chat__thinking" role="status">
            {copy.thinking}
          </div>
        )}
      </div>

      <div className="context-chat__examples" aria-label="Example questions">
        {EXAMPLES[station].map((example) => (
          <button key={example} type="button" onClick={() => ask(example)} disabled={busy}>
            {example}
          </button>
        ))}
      </div>

      <form
        className="context-chat__form"
        onSubmit={(event) => {
          event.preventDefault()
          ask()
        }}
      >
        <label className="context-chat__label" htmlFor={`context-chat-${station}`}>
          {copy.label}
        </label>
        <textarea
          id={`context-chat-${station}`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={copy.placeholder}
          rows={2}
        />
        <button type="submit" disabled={busy || question.trim().length === 0}>
          Ask
        </button>
      </form>

      {error && <div className="context-chat__error">{error}</div>}
    </section>
  )
}

export default ContextChat
