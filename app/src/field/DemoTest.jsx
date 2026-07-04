// One-tap demo / diagnostic for phones (PRD §5C, hackathon smoke test).
//
// Press a button, a realistic field report is filled in for you, then the demo
// runs the REAL mobile chain end-to-end and shows both halves:
//   1. Gemma ingestion  — POST /api/reports (parse → dedup → match on the hub)
//   2. Knowledge base    — POST /api/advise  (Rares' protocol KB, via the proxy)
// Each stage reports PASS/FAIL + latency, so on a phone you can see at a glance
// whether Gemma is ingesting AND whether the KB is answering. Uses the shared
// api.js client, so it works against the live hub or the offline mock layer.

import { useState } from 'react'
import { api, API_BASE, USE_MOCKS } from '../shared/api.js'
import Icon from '../shared/Icon.jsx'
import { useI18n } from '../shared/i18n.jsx'

// Messy, urgent, Spanish — the kind of report the intake agent must handle.
// `expect` is only a hint shown to the tester; the real category comes from Gemma.
const SAMPLES = [
  {
    expect: 'rescate',
    text:
      'urgente!! edificio de 3 pisos colapsado en Maiquetía cerca del terminal, ' +
      'se escuchan golpes y voces bajo los escombros, calculamos unas 12 personas ' +
      'atrapadas, necesitamos maquinaria pesada y rescatistas YA',
  },
  {
    expect: 'agua',
    text:
      'el refugio de la escuela básica en Catia La Mar lleva dos días sin agua ' +
      'potable, hay como 200 personas, vi niños tomando agua de un río, hace falta ' +
      'una cisterna urgente',
  },
  {
    expect: 'médico',
    text:
      'en el refugio San José hay una señora diabética que lleva dos días sin ' +
      'insulina y un niño con fiebre muy alta, necesitamos atención médica',
  },
  {
    expect: 'refugio / enfermedad',
    text:
      'muchísima gente amontonada en el gimnasio municipal, no hay letrinas ' +
      'suficientes y tememos brotes de enfermedad, calculamos unas 300 personas',
  },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// On a CPU-only laptop one Gemma parse can outlast the hub's ack window, so the
// report comes back with incident:null and the incident lands later via the
// board. Poll the report until it links to an incident, then fetch it.
async function pollForIncident(reportId, { deadlineMs = 90000, intervalMs = 2500 }) {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    await sleep(intervalMs)
    try {
      const reports = await api.getReports([reportId])
      const parsedInto = reports.find((r) => r.id === reportId)?.parsed_into
      if (parsedInto) {
        const incidents = await api.getIncidents()
        const inc = incidents.find((i) => i.id === parsedInto)
        if (inc) return inc
      }
    } catch {
      /* transient — keep polling until the deadline */
    }
  }
  return null
}

function StatusPill({ status }) {
  const { t } = useI18n()
  const map = {
    idle: { cls: 'demo-pill--idle', key: 'demo.pill.idle' },
    running: { cls: 'demo-pill--run', key: 'demo.pill.running' },
    pending: { cls: 'demo-pill--run', key: 'demo.pill.pending' },
    pass: { cls: 'demo-pill--pass', key: 'demo.pill.pass' },
    fail: { cls: 'demo-pill--fail', key: 'demo.pill.fail' },
  }
  const s = map[status] ?? map.idle
  return <span className={`demo-pill ${s.cls}`}>{t(s.key)}</span>
}

function StepCard({ n, title, subtitle, step }) {
  const status = step?.status ?? 'idle'
  return (
    <div className={`demo-step demo-step--${status}`}>
      <div className="demo-step__head">
        <span className="demo-step__n">{n}</span>
        <div className="demo-step__titles">
          <div className="demo-step__title">{title}</div>
          <div className="demo-step__sub">{subtitle}</div>
        </div>
        <StatusPill status={status} />
        {typeof step?.latencyMs === 'number' && (
          <span className="demo-step__lat">{(step.latencyMs / 1000).toFixed(1)}s</span>
        )}
      </div>
      {step?.note && <div className="demo-note">{step.note}</div>}
      {step?.error && <div className="demo-error">{step.error}</div>}
    </div>
  )
}

function DemoTest({ sourceDevice = null, lang = 'es', onClose }) {
  const { t } = useI18n()
  const [sampleIdx, setSampleIdx] = useState(0)
  const [text, setText] = useState(SAMPLES[0].text)
  const [running, setRunning] = useState(false)
  const [step1, setStep1] = useState(null)
  const [step2, setStep2] = useState(null)

  const cycleSample = () => {
    const next = (sampleIdx + 1) % SAMPLES.length
    setSampleIdx(next)
    setText(SAMPLES[next].text)
    setStep1(null)
    setStep2(null)
  }

  const runTest = async () => {
    if (running || !text.trim()) return
    setRunning(true)
    setStep1({ status: 'running' })
    setStep2(null)

    const device = sourceDevice || `demo-phone-${Math.random().toString(36).slice(2, 6)}`

    // ---- Step 1: Gemma ingestion (phone → hub → parse/dedup/match) ----
    let incident = null
    const t0 = performance.now()
    try {
      const data = await api.submitReport({ text: text.trim(), source_device: device, lang })
      incident = data?.incident || null
      if (!incident && data?.report?.id) {
        setStep1({ status: 'pending', note: t('demo.pending') })
        incident = await pollForIncident(data.report.id, {})
      }
      const latencyMs = Math.round(performance.now() - t0)
      if (!incident) {
        setStep1({
          status: 'fail',
          latencyMs,
          error: t('demo.noIncident'),
        })
        setRunning(false)
        return
      }
      setStep1({ status: 'pass', latencyMs, incident })
    } catch (err) {
      setStep1({
        status: 'fail',
        latencyMs: Math.round(performance.now() - t0),
        error: err?.offline ? t('demo.unreachable') : err.message,
      })
      setRunning(false)
      return
    }

    // ---- Step 2: Knowledge base advisory (uses the incident Gemma produced) ----
    setStep2({ status: 'running' })
    const t1 = performance.now()
    try {
      const advisory = await api.advise({
        incident_type: incident.category,
        context: incident.summary || '',
      })
      const latencyMs = Math.round(performance.now() - t1)
      const steps = Array.isArray(advisory?.steps) ? advisory.steps : []
      if (steps.length === 0) {
        setStep2({ status: 'fail', latencyMs, advisory, error: t('demo.kbNoSteps') })
      } else {
        setStep2({ status: 'pass', latencyMs, advisory })
      }
    } catch (err) {
      setStep2({ status: 'fail', latencyMs: Math.round(performance.now() - t1), error: err.message })
    } finally {
      setRunning(false)
    }
  }

  const inc = step1?.status === 'pass' ? step1.incident : null
  const advisory = step2?.status === 'pass' ? step2.advisory : null
  const verdict =
    step1?.status === 'pass' && step2?.status === 'pass'
      ? 'pass'
      : step1?.status === 'fail' || step2?.status === 'fail'
        ? 'fail'
        : null

  return (
    <div className="demo-overlay" role="dialog" aria-modal="true">
      <div className="demo-sheet">
        <header className="demo-header">
          <div>
            <div className="demo-header__title">{t('demo.title')}</div>
            <div className="demo-header__sub">
              {t('demo.subtitle')} · {USE_MOCKS ? t('demo.subtitleMock') : t('demo.subtitleLive')}
            </div>
          </div>
          <button type="button" className="demo-close" onClick={onClose} aria-label={t('demo.close')}>
            <Icon name="close" />
          </button>
        </header>

        <div className="demo-body">
          <p className="demo-intro">{t('demo.intro')}</p>

          <div className="demo-samplebar">
            <span className="demo-samplebar__hint">{t('demo.expected', { expect: SAMPLES[sampleIdx].expect })}</span>
            <button type="button" className="chip" onClick={cycleSample} disabled={running}>
              <Icon name="refresh" />
              {t('demo.another')}
            </button>
          </div>

          <textarea
            className="report-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={running}
            rows={5}
          />

          <button type="button" className="send-btn" onClick={runTest} disabled={running || !text.trim()}>
            {!running && <Icon name="lab" />}
            {running ? t('demo.running') : t('demo.run')}
          </button>

          {verdict && (
            <div className={`demo-verdict demo-verdict--${verdict}`}>
              {verdict === 'pass' ? t('demo.verdictPass') : t('demo.verdictFail')}
            </div>
          )}

          {(step1 || step2) && (
            <div className="demo-steps">
              <StepCard
                n="1"
                title={t('demo.step1Title')}
                subtitle={t('demo.step1Sub')}
                step={step1}
              />
              {inc && (
                <div className="demo-detail">
                  <div className="demo-detail__row">
                    <span className="cat-badge">{t(`cat.${inc.category}`)}</span>
                    <span className={`demo-urg urgency-${inc.urgency}`}>
                      {t('demo.urgency', { level: t(`urg.${inc.urgency}`) })}
                    </span>
                    {inc.people_count != null && <span className="demo-detail__meta">{inc.people_count} {t('common.people')}</span>}
                    {inc.location && <span className="demo-detail__meta">{inc.location}</span>}
                  </div>
                  <div className="demo-detail__summary">“{inc.summary}”</div>
                </div>
              )}

              <StepCard
                n="2"
                title={t('demo.step2Title')}
                subtitle={t('demo.step2Sub')}
                step={step2}
              />
              {advisory && (
                <div className="demo-detail">
                  {advisory.source_label && (
                    <div className="demo-detail__source">{t('demo.source', { label: advisory.source_label })}</div>
                  )}
                  <ol className="demo-advisory">
                    {advisory.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  {Array.isArray(advisory.cautions) && advisory.cautions.length > 0 && (
                    <div className="demo-cautions">
                      <Icon name="caution" />
                      {advisory.cautions.join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="demo-target">{t('demo.target', { base: API_BASE })}</div>
        </div>
      </div>
    </div>
  )
}

export default DemoTest
