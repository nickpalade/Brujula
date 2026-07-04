// Outbox view — the visible store-and-forward status per report.
// QUEUED (amber) → SYNCED (green) → PARSED (teal). This is the panel the demo
// points at: kill the hub, submit, watch items sit QUEUED; restart, watch them
// flip to SYNCED/PARSED.

import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../shared/i18n.jsx'
import { api } from '../shared/api.js'
import PixelCard from '../vendor/PixelCard.jsx'

const REPORTER_GUIDANCE = {
  rescue: [
    'Stay outside unstable buildings, debris piles, and damaged walls.',
    'From a safe place, listen for voices or tapping and remember the exact spot.',
    'Keep bystanders quiet when rescuers are listening and leave access paths open.',
    'Tell responders how many people may be trapped and any hazards you saw.',
  ],
  medical: [
    'Check if the person is breathing and responsive without moving them unnecessarily.',
    'For heavy bleeding, apply firm pressure with a clean cloth if it is safe to do so.',
    'Keep the person warm, still, and reassured while help is coming.',
    'Share symptoms, age, medicines, and timing with responders when they arrive.',
  ],
  water: [
    'Do not drink from water that smells, looks dirty, or may be near sewage.',
    'Keep clean containers covered and separated from dirty containers.',
    'Tell nearby people where unsafe water was found so they avoid it.',
    'Report how many people need water and whether children or older adults are affected.',
  ],
  shelter: [
    'Move people away from cracked walls, falling glass, floodwater, or exposed wires.',
    'Help children, older adults, disabled people, and injured people reach a safer open area.',
    'Keep families together and note anyone missing before responders arrive.',
    'Share crowding, sanitation, and urgent supply needs with the command post.',
  ],
  food: [
    'Keep any available food dry, covered, and away from fuel, chemicals, or floodwater.',
    'Prioritize children, older adults, pregnant people, and people with medical needs.',
    'Report how many people need food and whether anyone has urgent dietary needs.',
  ],
  machinery: [
    'Keep people away from heavy equipment, unstable rubble, and blind spots.',
    'Mark the safest access route if you can do it without entering danger.',
    'Warn responders about power lines, gas smell, fire, or blocked roads.',
  ],
  hazard: [
    'Move upwind or uphill from smoke, gas smells, chemicals, or floodwater.',
    'Keep others back and avoid touching unknown substances or exposed wires.',
    'Report the smell, color, sound, location, and whether anyone is sick or trapped.',
  ],
  status: [
    'Stay in a safe place and keep your phone available for follow-up questions.',
    'Update the report if the situation changes or someone becomes injured.',
    'Keep the area clear for responders and follow official alerts from the hub.',
  ],
}

function getReporterSteps(category) {
  return REPORTER_GUIDANCE[category] ?? REPORTER_GUIDANCE.status
}

function ReportGuidance({ item, incident }) {
  const [advisory, setAdvisory] = useState(null)
  const [loading, setLoading] = useState(false)
  const category = incident?.category || item.category || 'status'
  const summary = incident?.summary || item.text || ''
  const isReady = item.status === 'PARSED' || item.status === 'SYNCED'

  useEffect(() => {
    if (!isReady) return undefined
    let cancelled = false
    setLoading(true)
    setAdvisory(null)
    api.advise({ incident_type: category, context: summary })
      .then((data) => !cancelled && setAdvisory(data))
      .catch(() => !cancelled && setAdvisory(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [category, isReady, summary])

  if (!isReady) return null

  const steps = getReporterSteps(category)

  return (
    <div className="report-guidance">
      <div className="report-guidance__head">
        <span>How to help now</span>
        {loading ? <small>checking guidance...</small> : null}
      </div>
      <ol className="report-guidance__steps">
        {steps.map((step, idx) => (
          <li key={idx}>{step}</li>
        ))}
      </ol>
      <div className="report-guidance__note">
        Do not put yourself in danger. If the scene becomes unsafe, move away and update the report.
      </div>
      {advisory?.source_label && (
        <div className="report-guidance__source">
          Based on local response guidance: {advisory.source_label}
        </div>
      )}
    </div>
  )
}

function timeAgo(t, iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const prefix = t('time.agoPrefix')
  const suffix = t('time.agoSuffix')
  if (s < 60) return `${prefix}${s}s${suffix}`
  const m = Math.floor(s / 60)
  if (m < 60) return `${prefix}${m}m${suffix}`
  return `${prefix}${Math.floor(m / 60)}h${suffix}`
}

function QueueList({ items, onClearSynced, incidents = [] }) {
  const { t } = useI18n()
  const incidentById = useMemo(
    () => new Map((incidents || []).map((incident) => [incident.id, incident])),
    [incidents],
  )

  if (!items || items.length === 0) {
    return (
      <div className="empty">
        {t('q.empty1')}
        <br />
        {t('q.empty2')}
      </div>
    )
  }

  const hasSynced = items.some((it) => it.status === 'SYNCED' || it.status === 'PARSED')

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span className="section-title">{t('q.mine')}</span>
        {hasSynced && (
          <button
            type="button"
            className="chip"
            style={{ minHeight: 32, padding: '6px 12px', fontSize: 13 }}
            onClick={onClearSynced}
          >
            {t('q.clearSynced')}
          </button>
        )}
      </div>

      {items.map((it) => {
        const outgoing = it.status === 'QUEUED' || it.status === 'ERROR'
        const card = (
        <div className={`card${outgoing ? ' card--in-pixel' : ''}`}>
          <div className="card-top">
            {it.category ? (
              <span className="cat-badge">{t(`cat.${it.category}`)}</span>
            ) : (
              <span className="cat-badge">{t('q.noCategory')}</span>
            )}
            <span className={`status-badge st-${it.status}`}>
              {t(`status.${it.status}`)}
            </span>
          </div>
          <div className="card-text">{it.text || (it.has_image ? t('q.photoReport') : '')}</div>
          <div className="card-meta">
            {it.has_image && <span>{t('q.photo')}</span>}
            {it.people_count != null && (
              <span>
                {it.people_count} {t('common.people')}
              </span>
            )}
            {it.location && <span>{it.location}</span>}
            <span>{timeAgo(t, it.created_at)}</span>
            {it.status === 'ERROR' && it.error && (
              <span className="urgency-critical">{it.error}</span>
            )}
          </div>
          <ReportGuidance item={it} incident={incidentById.get(it.incident_id)} />
        </div>
        )
        return outgoing ? (
          <PixelCard key={it.localId} variant="ambar" autoAnimate className="assign-pixel">
            {card}
          </PixelCard>
        ) : (
          <div key={it.localId}>{card}</div>
        )
      })}
    </div>
  )
}

export default QueueList
