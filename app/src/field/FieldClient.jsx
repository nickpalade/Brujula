// Brújula — Field client (PRD §5C, mobile-first, route /field).
// First open: sign up as reporter / volunteer / specialized crew (Onboarding).
// Volunteers and crews are registered on the hub as dispatchable resources;
// reporters only submit reports. Then: submit reports (store-and-forward),
// receive assignments. Uses the shared api.js client.

import { useEffect, useMemo, useRef, useState } from 'react'
import './field.css'
import { api, USE_MOCKS } from '../shared/api.js'
import Icon from '../shared/Icon.jsx'
import { useI18n } from '../shared/i18n.jsx'
import { LANGUAGES } from '../shared/languages.js'
import { useAgentBusy } from '../shared/useAgentBusy.js'
import BrujulaMark from '../shared/BrujulaMark.jsx'
import DotGrid from '../vendor/DotGrid.jsx'
import { useOutbox } from './useOutbox.js'
import { useAssignments } from './useAssignments.js'
import Onboarding from './Onboarding.jsx'
import ReportForm from './ReportForm.jsx'
import QueueList from './QueueList.jsx'
import AssignmentInbox from './AssignmentInbox.jsx'
import AlertBanner from './AlertBanner.jsx'
import DemoTest from './DemoTest.jsx'

const PROFILE_KEY = 'brujula.field.profile.v1'
const REGISTER_RETRY_MS = 8000

const FIELD_STATUS_IDS = ['idle', 'traveling', 'on_site', 'returning']

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

// Settings menu (gear icon) — the single home for secondary field actions so
// the mobile header stays uncluttered on narrow phones. Holds the display-
// language switcher (a phone handed to another responder can flip the UI
// language without wiping the profile), the demo/diagnostic launcher, and the
// change-profile reset. Opens a dropdown; closes on outside click or Escape.
function SettingsMenu({ onChangeLang, onOpenDemo, onResetProfile }) {
  const { lang, setLang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (code) => {
    setLang(code)
    onChangeLang?.(code)
    setOpen(false)
  }

  const run = (fn) => {
    setOpen(false)
    fn?.()
  }

  return (
    <div className="field-settings" ref={ref}>
      <button
        type="button"
        className="field-settings__btn"
        aria-label={t('settings.title')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('settings.title')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="settings" />
        <span className="field-settings__btn-label">{t('settings.title')}</span>
      </button>
      {open && (
        <div className="field-settings__menu" role="menu">
          <div className="field-settings__label">
            <Icon name="globe" />
            {t('lang.label')}
          </div>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={lang === l.code}
              className={`field-settings__item${lang === l.code ? ' selected' : ''}`}
              onClick={() => pick(l.code)}
            >
              <span>{l.name}</span>
              {lang === l.code && <Icon name="check" />}
            </button>
          ))}

          {(onOpenDemo || onResetProfile) && <div className="field-settings__sep" />}
          {onOpenDemo && (
            <button
              type="button"
              role="menuitem"
              className="field-settings__item"
              onClick={() => run(onOpenDemo)}
            >
              <span className="field-settings__item-label">
                <Icon name="lab" />
                {t('demo.launch')}
              </span>
            </button>
          )}
          {onResetProfile && (
            <button
              type="button"
              role="menuitem"
              className="field-settings__item"
              onClick={() => run(onResetProfile)}
            >
              <span>{t('settings.changeProfile')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ConnPill({ online }) {
  const { t } = useI18n()
  return (
    <span className={`conn-pill ${online ? 'conn-online' : 'conn-offline'}`}>
      <span className="dot" />
      {online ? t('conn.online') : t('conn.offline')}
    </span>
  )
}

// Mission-state control for volunteers/crews. What the coordinator's agent
// sees: traveling/on_site = engaged (never proposed); returning = re-taskable;
// idle = fully back in the pool.
function StatusBar({ current, onChange, busy }) {
  const { t } = useI18n()
  return (
    <div className="status-bar">
      <span className="status-bar-label">{t('fstatus.label')}</span>
      <div className="chip-row">
        {FIELD_STATUS_IDS.map((id) => (
          <button
            key={id}
            type="button"
            disabled={busy}
            className={`chip chip-small${current === id ? ' selected' : ''}`}
            onClick={() => onChange(id)}
          >
            {t(`fstatus.${id}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

function FieldClient() {
  const { lang, t } = useI18n()
  const [profile, setProfile] = useState(loadProfile)
  const [tab, setTab] = useState('report')
  const [toast, setToast] = useState(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const agentBusy = useAgentBusy()

  useRegistration(profile)

  const isReporter = profile?.role === 'reporter'
  const reportedBy = profile ? `${profile.name} · ${t(`role.${profile.role}.short`)}` : null

  // Keep the saved profile's language in sync with the live UI language so new
  // reports carry the responder's current display language.
  const changeLang = (next) => {
    if (!profile || profile.lang === next) return
    const updated = { ...profile, lang: next }
    saveProfile(updated)
    setProfile(updated)
  }

  const setFieldStatus = async (field_status) => {
    if (!profile || statusBusy) return
    setStatusBusy(true)
    try {
      await api.setCrewStatus({ device_id: profile.device_id, field_status })
      const next = { ...profile, field_status }
      saveProfile(next)
      setProfile(next)
    } catch {
      setToast(t('toast.statusFailed'))
      setTimeout(() => setToast(null), 2500)
    } finally {
      setStatusBusy(false)
    }
  }

  const { items, enqueue, online, clearSynced } = useOutbox(
    profile?.device_id ?? 'unregistered',
    reportedBy,
    lang,
  )

  const myIncidentIds = useMemo(
    () => items.map((it) => it.incident_id).filter(Boolean),
    [items],
  )
  const { assignments, acknowledge, unackedCount, alerts } = useAssignments(myIncidentIds)

  if (!profile) {
    return (
      <div className="field-app">
        <header className="field-header">
          <div className="field-brand">
            <BrujulaMark size={32} spinning={agentBusy} />
            <div>
              <h1>{t('field.title')}</h1>
              <div className="field-sub">{USE_MOCKS ? t('field.demo') : t('field.unregistered')}</div>
            </div>
          </div>
          <button type="button" className="demo-launch" onClick={() => setDemoOpen(true)}>
            <Icon name="lab" />
            {t('demo.launch')}
          </button>
        </header>
        <AlertBanner alerts={alerts} />
        <main className="field-body">
          <Onboarding
            onComplete={(p) => {
              saveProfile(p)
              setProfile(p)
            }}
          />
        </main>
        {demoOpen && <DemoTest lang={lang} onClose={() => setDemoOpen(false)} />}
      </div>
    )
  }

  const handleSubmit = (report) => {
    enqueue(report)
    setToast(t('toast.saved'))
    setTimeout(() => setToast(null), 2500)
  }

  const resetProfile = () => {
    saveProfile(null)
    setProfile(null)
    setTab('report')
  }

  return (
    <div className="field-app">
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
        <div className="field-header__left field-brand">
          <BrujulaMark size={32} spinning={agentBusy} />
          <div>
            <h1>{t('field.title')}</h1>
            <div className="field-sub">
              {profile.name} · {t(`role.${profile.role}.short`)}
              {USE_MOCKS ? ` · ${t('field.demo')}` : ''}
            </div>
          </div>
        </div>
        <div className="field-header__right">
          <ConnPill online={online} />
          <SettingsMenu
            onChangeLang={changeLang}
            onOpenDemo={() => setDemoOpen(true)}
            onResetProfile={resetProfile}
          />
        </div>
      </header>

      <AlertBanner alerts={alerts} />

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

      {demoOpen && (
        <DemoTest
          sourceDevice={profile.device_id}
          lang={lang}
          onClose={() => setDemoOpen(false)}
        />
      )}

      {!isReporter && (
        <nav className="field-tabs">
          <button
            type="button"
            className={`field-tab${tab === 'report' ? ' active' : ''}`}
            onClick={() => setTab('report')}
          >
            {t('tab.report')}
          </button>
          <button
            type="button"
            className={`field-tab${tab === 'inbox' ? ' active' : ''}`}
            onClick={() => setTab('inbox')}
          >
            {t('tab.inbox')}
            {unackedCount > 0 && <span className="badge-count">{unackedCount}</span>}
          </button>
        </nav>
      )}
    </div>
  )
}

export default FieldClient
