// Assignment inbox — dispatches from the Command Post involving this device.
// Each shows the AI/coordinator's tasking (resource → incident + rationale) and
// a mission-progress flow: confirmed → accepted → en_route → on_site → done.
// Completed missions show outcome. Withdrawn missions are hidden.

import { useState } from 'react'
import { useI18n } from '../shared/i18n.jsx'
import { api } from '../shared/api.js'
import { useFieldStrings } from './fieldStrings.js'
import PixelCard from '../vendor/PixelCard.jsx'

const STATE_ORDER = ['confirmed', 'accepted', 'en_route', 'on_site', 'done']

function MissionStepIndicator({ currentState }) {
  const fs = useFieldStrings()
  const steps = [
    fs('mission.step.confirmed'),
    fs('mission.step.accepted'),
    fs('mission.step.enroute'),
    fs('mission.step.onsite'),
    fs('mission.step.done'),
  ]
  const currentIndex = STATE_ORDER.indexOf(currentState)

  return (
    <div className="mission-steps">
      {steps.map((step, idx) => (
        <div
          key={idx}
          className={`mission-step${idx <= currentIndex ? ' completed' : ''}${
            idx === currentIndex ? ' active' : ''
          }`}
        >
          <div className="mission-step-dot" />
          <div className="mission-step-label">{step}</div>
        </div>
      ))}
    </div>
  )
}

function OutcomeForm({ onSubmit, onCancel, busy }) {
  const fs = useFieldStrings()
  const [outcome, setOutcome] = useState('')

  const handleSubmit = () => {
    onSubmit(outcome.trim())
  }

  return (
    <div className="outcome-form">
      <label className="field-label">{fs('mission.outcome.label')}</label>
      <textarea
        className="report-textarea"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        placeholder={fs('mission.outcome.placeholder')}
        disabled={busy}
      />
      <div className="outcome-buttons">
        <button
          type="button"
          className="send-btn"
          onClick={handleSubmit}
          disabled={busy || !outcome.trim()}
        >
          {busy ? fs('mission.busy') : fs('mission.confirm')}
        </button>
        <button
          type="button"
          className="ack-btn"
          onClick={onCancel}
          disabled={busy}
          style={{ marginTop: 8 }}
        >
          {fs('mission.cancel')}
        </button>
      </div>
    </div>
  )
}

function AssignmentCard({ a, onStateChange }) {
  const { t } = useI18n()
  const fs = useFieldStrings()
  const [showOutcomeForm, setShowOutcomeForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const incident = a.incident
  const resource = a.resource
  const urgency = incident?.urgency

  const handleStateChange = async (nextState) => {
    setBusy(true)
    setError(null)
    try {
      await api.setDispatchStatus(a.id, { state: nextState })
      onStateChange?.()
    } catch (err) {
      setError(fs('mission.error'))
    } finally {
      setBusy(false)
    }
  }

  const handleCompleteClick = () => {
    setShowOutcomeForm(true)
  }

  const handleOutcomeSubmit = async (outcome) => {
    setBusy(true)
    setError(null)
    try {
      await api.setDispatchStatus(a.id, { state: 'done', outcome })
      setShowOutcomeForm(false)
      onStateChange?.()
    } catch (err) {
      setError(fs('mission.error'))
      setBusy(false)
    }
  }

  const handleOutcomeCancel = () => {
    setShowOutcomeForm(false)
  }

  const actionButton = (() => {
    switch (a.state) {
      case 'confirmed':
        return (
          <button
            type="button"
            className="send-btn"
            onClick={() => handleStateChange('accepted')}
            disabled={busy}
          >
            {busy ? fs('mission.busy') : fs('mission.accept')}
          </button>
        )
      case 'accepted':
        return (
          <button
            type="button"
            className="send-btn"
            onClick={() => handleStateChange('en_route')}
            disabled={busy}
          >
            {busy ? fs('mission.busy') : fs('mission.enroute')}
          </button>
        )
      case 'en_route':
        return (
          <button
            type="button"
            className="send-btn"
            onClick={() => handleStateChange('on_site')}
            disabled={busy}
          >
            {busy ? fs('mission.busy') : fs('mission.onsite')}
          </button>
        )
      case 'on_site':
        return (
          <button
            type="button"
            className="send-btn"
            onClick={handleCompleteClick}
            disabled={busy || showOutcomeForm}
          >
            {busy ? fs('mission.busy') : fs('mission.complete')}
          </button>
        )
      case 'done':
        return (
          <div className="mission-completed">
            <div className="mission-status">{fs('mission.completed')}</div>
            {a.outcome && (
              <div className="mission-outcome">
                <strong>{fs('mission.outcome.label')}:</strong> {a.outcome}
              </div>
            )}
          </div>
        )
      case 'withdrawn':
        return null
      default:
        return null
    }
  })()

  const showSteps = a.state !== 'withdrawn' && a.state !== 'done'

  return (
    <div className="card">
      <div className="card-top">
        <span className="cat-badge">
          {incident?.category ? t(`cat.${incident.category}`) : t('ai.assignment')}
        </span>
        {urgency && (
          <span className={`status-badge urgency-${urgency}`}>
            {urgency.toUpperCase()}
          </span>
        )}
      </div>

      <div className="assign-title">
        {resource ? resource.label : a.resource_id}
      </div>
      <div className="card-text">
        → {incident?.summary || incident?.location || a.incident_id}
      </div>

      {a.rationale && <div className="assign-rationale">{a.rationale}</div>}

      <div className="card-meta">
        {incident?.location && <span>{incident.location}</span>}
        {resource?.location && <span>{t('common.from')} {resource.location}</span>}
      </div>

      {showSteps && <MissionStepIndicator currentState={a.state} />}

      {showOutcomeForm && (
        <OutcomeForm
          onSubmit={handleOutcomeSubmit}
          onCancel={handleOutcomeCancel}
          busy={busy}
        />
      )}

      {!showOutcomeForm && actionButton}

      {error && <div className="mission-error">{error}</div>}
    </div>
  )
}

function AssignmentInbox({ assignments, onAcknowledge }) {
  const { t } = useI18n()
  const [refreshKey, setRefreshKey] = useState(0)

  if (!assignments || assignments.length === 0) {
    return (
      <div className="empty">
        {t('ai.empty1')}
        <br />
        {t('ai.empty2')}
      </div>
    )
  }

  const visibleAssignments = assignments.filter((a) => a.state !== 'withdrawn')

  if (visibleAssignments.length === 0) {
    return (
      <div className="empty">
        {t('ai.empty1')}
        <br />
        {t('ai.empty2')}
      </div>
    )
  }

  return (
    <div key={refreshKey}>
      <span className="section-title">{t('ai.title')}</span>
      {visibleAssignments.map((a) => {
        const card = (
          <AssignmentCard
            a={a}
            onStateChange={() => setRefreshKey((k) => k + 1)}
          />
        )
        return a.state === 'confirmed' ? (
          <PixelCard key={a.id} variant="garnet" autoAnimate className="assign-pixel">
            {card}
          </PixelCard>
        ) : (
          <div key={a.id}>{card}</div>
        )
      })}
    </div>
  )
}

export default AssignmentInbox
