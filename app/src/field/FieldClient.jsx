// Brújula — Field client (PRD §5C, mobile-first, route /field).
// First open: sign up as reporter / volunteer / specialized crew (Onboarding).
// Volunteers and crews are registered on the hub as dispatchable resources;
// reporters only submit reports. Then: submit reports (store-and-forward),
// receive assignments. Uses the shared api.js client.

import { useEffect, useMemo, useRef, useState } from 'react'
import './field.css'
import { api, USE_MOCKS } from '../shared/api.js'
import BrujulaMark from '../shared/BrujulaMark.jsx'
import DotGrid from '../vendor/DotGrid.jsx'
import { useOutbox } from './useOutbox.js'
import { useAssignments } from './useAssignments.js'
import Onboarding from './Onboarding.jsx'
import ReportForm from './ReportForm.jsx'
import QueueList from './QueueList.jsx'
import AssignmentInbox from './AssignmentInbox.jsx'

const PROFILE_KEY = 'brujula.field.profile.v1'
const REGISTER_RETRY_MS = 8000

const ROLE_LABEL = {
  reporter: 'reportero',
  volunteer: 'voluntario',
  crew: 'equipo especializado',
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveProfile(profile) {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
    else localStorage.removeItem(PROFILE_KEY)
  } catch {
    /* private mode — profile lives in memory this session */
  }
}

// Register (upsert) this device on the hub; retries until it lands once.
// Safe to re-run on every launch — the hub upserts by device_id, and a
// board reseed wipes registrations, so re-registering keeps us on the roster.
function useRegistration(profile) {
  const doneRef = useRef(false)
  useEffect(() => {
    doneRef.current = false
    if (!profile) return undefined
    let cancelled = false
    const attempt = async () => {
      if (cancelled || doneRef.current) return
      try {
        await api.register(profile)
        doneRef.current = true
      } catch {
        /* hub unreachable — retry on the next tick */
      }
    }
    attempt()
    const id = setInterval(attempt, REGISTER_RETRY_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [profile])
}

function ConnPill({ online }) {
  return (
    <span className={`conn-pill ${online ? 'conn-online' : 'conn-offline'}`}>
      <span className="dot" />
      {online ? 'Hub conectado' : 'Sin conexión'}
    </span>
  )
}

// Mission-state control for volunteers/crews. What the coordinator's agent
// sees: traveling/on_site = engaged (never proposed); returning = re-taskable;
// idle = fully back in the pool.
const FIELD_STATUSES = [
  { id: 'idle', label: 'Disponible' },
  { id: 'traveling', label: 'En camino' },
  { id: 'on_site', label: 'En el sitio' },
  { id: 'returning', label: 'Regresando' },
]

function StatusBar({ current, onChange, busy }) {
  return (
    <div className="status-bar">
      <span className="status-bar-label">Mi estado</span>
      <div className="chip-row">
        {FIELD_STATUSES.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy}
            className={`chip chip-small${current === s.id ? ' selected' : ''}`}
            onClick={() => onChange(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function FieldClient() {
  const [profile, setProfile] = useState(loadProfile)
  const [tab, setTab] = useState('report')
  const [toast, setToast] = useState(null)
  const [statusBusy, setStatusBusy] = useState(false)

  useRegistration(profile)

  const isReporter = profile?.role === 'reporter'
  const reportedBy = profile ? `${profile.name} · ${ROLE_LABEL[profile.role]}` : null

  const setFieldStatus = async (field_status) => {
    if (!profile || statusBusy) return
    setStatusBusy(true)
    try {
      await api.setCrewStatus({ device_id: profile.device_id, field_status })
      const next = { ...profile, field_status }
      saveProfile(next)
      setProfile(next)
    } catch {
      setToast('Sin conexión — estado no enviado, reintenta')
      setTimeout(() => setToast(null), 2500)
    } finally {
      setStatusBusy(false)
    }
  }

  const { items, enqueue, online, clearSynced } = useOutbox(
    profile?.device_id ?? 'unregistered',
    reportedBy,
  )

  const myIncidentIds = useMemo(
    () => items.map((it) => it.incident_id).filter(Boolean),
    [items],
  )
  const { assignments, acknowledge, unackedCount } = useAssignments(myIncidentIds)

  if (!profile) {
    return (
      <div className="field-app">
        <header className="field-header">
          <div className="field-brand">
            <BrujulaMark size={32} spinning />
            <div>
              <h1>Brújula</h1>
              <div className="field-sub">
                Campo{USE_MOCKS ? ' · modo demo' : ' · sin registrar'}
              </div>
            </div>
          </div>
        </header>
        <main className="field-body">
          <Onboarding
            onComplete={(p) => {
              saveProfile(p)
              setProfile(p)
            }}
          />
        </main>
      </div>
    )
  }

  const handleSubmit = (report) => {
    enqueue(report)
    setToast('Reporte guardado — se enviará al hub')
    setTimeout(() => setToast(null), 2500)
  }

  const resetProfile = () => {
    saveProfile(null)
    setProfile(null)
    setTab('report')
  }

  return (
    <div className="field-app">
      {/* Whisper-level ambient dot field behind the working app — barely above
          the page dark; warms faintly toward garnet near the finger. */}
      <div className="field-dots" aria-hidden="true">
        <DotGrid
          dotSize={2.5}
          gap={26}
          baseColor="#131c16"
          activeColor="#5c2a31"
          proximity={80}
          speedTrigger={140}
          shockRadius={130}
          shockStrength={2.5}
          resistance={700}
          returnDuration={1.2}
        />
      </div>
      <header className="field-header">
        <div className="field-brand">
          <BrujulaMark size={32} spinning />
          <div>
            <h1>Brújula</h1>
            <div className="field-sub">
              {profile.name} · {ROLE_LABEL[profile.role]}
              {USE_MOCKS ? ' · modo demo' : ''}{' '}
              <button type="button" className="link-btn" onClick={resetProfile}>
                cambiar
              </button>
            </div>
          </div>
        </div>
        <ConnPill online={online} />
      </header>

      <main className="field-body">
        {!isReporter && (
          <StatusBar
            current={profile.field_status ?? 'idle'}
            onChange={setFieldStatus}
            busy={statusBusy}
          />
        )}
        {tab === 'report' || isReporter ? (
          <>
            <ReportForm onSubmit={handleSubmit} />
            <div style={{ marginTop: 28 }}>
              <QueueList items={items} onClearSynced={clearSynced} />
            </div>
          </>
        ) : (
          <AssignmentInbox assignments={assignments} onAcknowledge={acknowledge} />
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}

      {!isReporter && (
        <nav className="field-tabs">
          <button
            type="button"
            className={`field-tab${tab === 'report' ? ' active' : ''}`}
            onClick={() => setTab('report')}
          >
            Reportar
          </button>
          <button
            type="button"
            className={`field-tab${tab === 'inbox' ? ' active' : ''}`}
            onClick={() => setTab('inbox')}
          >
            Asignaciones
            {unackedCount > 0 && <span className="badge-count">{unackedCount}</span>}
          </button>
        </nav>
      )}
    </div>
  )
}

export default FieldClient
