import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'

import CommandPost from './command/CommandPost.jsx'
import CommandGraph from './command/CommandGraph.jsx'
import FieldClient from './field/FieldClient.jsx'
import IntroSplash from './shared/IntroSplash.jsx'
import BorderGlow from './shared/BorderGlow.jsx'
import './App.css'

const LOCAL_COMMAND_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const STATIONS = [
  {
    index: '01',
    to: '/graph',
    route: '/graph',
    accent: 'graph',
    title: 'Command Graph',
    device: 'Laptop · Gemma as the brain',
    desc: 'Manage incidents, resources, alerts and decisions as a flow of connected nodes.',
    primary: true,
  },
  {
    index: '02',
    to: '/command',
    route: '/command',
    accent: 'command',
    title: 'Command Post',
    device: 'Laptop · Operations room',
    desc: 'Legacy view. Superseded by the Command Graph — kept for reference only.',
    deprecated: true,
  },
  {
    index: '03',
    to: '/field',
    route: '/field',
    accent: 'field',
    title: 'Field Client',
    device: 'Mobile · First line',
    desc: 'Voice and photo report capture, offline queue and assignment delivery.',
  },
]

function isLocalCommandHost(hostname) {
  return (
    LOCAL_COMMAND_HOSTS.has(hostname) ||
    hostname.startsWith('127.') ||
    hostname === ''
  )
}

function Home() {
  return (
    <div className="bru-app bru-landing">
      <div className="bru-landing__scan" aria-hidden="true" />

      <header className="bru-landing__bar">
        <span className="bru-landing__brandmark">BRÚJULA</span>
        <span className="bru-landing__status">
          <i className="bru-landing__pulse" />
          SYSTEM OPERATIONAL · NO CONNECTION REQUIRED
        </span>
      </header>

      <main className="bru-landing__main">
        <section className="bru-landing__hero">
          <img
            className="bru-landing__compass"
            src="/logo-animated.svg"
            alt="Brújula — spinning needle"
            width="132"
            height="132"
          />
          <div className="bru-landing__wordmark">
            <h1>
              BRÚ<span>JULA</span>
            </h1>
            <p className="bru-landing__tagline">
              Emergency coordination that works{' '}
              <em>when the network doesn't</em>.
            </p>
          </div>
        </section>

        <p className="bru-landing__testnote" role="note">
          <span className="bru-landing__testnote-tag">TESTING ONLY</span>
          This station selector exists for local testing only. In a real
          deployment, this machine would open the{' '}
          <strong>Command Graph</strong> (/graph) directly.
        </p>

        <p className="bru-landing__prompt">
          <span className="bru-landing__prompt-tick">▸</span> Select a station
          to deploy
        </p>

        <nav className="bru-landing__grid">
          {STATIONS.map((s, i) => (
            <BorderGlow
              key={s.to}
              className="bru-console-glow"
              borderRadius={14}
              backgroundColor="var(--bru-bg-1)"
            >
            <Link
              to={s.to}
              className={`bru-console${s.deprecated ? ' bru-console--deprecated' : ''}`}
              data-accent={s.accent}
              style={{ '--reveal-delay': `${0.12 + i * 0.1}s` }}
            >
              <span className="bru-console__corner bru-console__corner--tl" />
              <span className="bru-console__corner bru-console__corner--br" />

              <div className="bru-console__head">
                <span className="bru-console__index">{s.index}</span>
                <span className="bru-console__route">{s.route}</span>
              </div>

              <div className="bru-console__title">
                <h2>{s.title}</h2>
                {s.primary && (
                  <span className="bru-console__flag bru-console__flag--primary">
                    PRIMARY
                  </span>
                )}
                {s.deprecated && (
                  <span className="bru-console__flag bru-console__flag--deprecated">
                    DEPRECATED
                  </span>
                )}
              </div>

              <p className="bru-console__desc">{s.desc}</p>

              <div className="bru-console__foot">
                <span className="bru-console__device">{s.device}</span>
                <span className="bru-console__enter">
                  {s.deprecated ? 'VIEW LEGACY' : 'ENTER'}{' '}
                  <span className="bru-console__arrow">→</span>
                </span>
              </div>
            </Link>
            </BorderGlow>
          ))}
        </nav>
      </main>

      <footer className="bru-landing__foot">
        <span>LAT 40.4168 · LON −3.7038</span>
        <span className="bru-landing__foot-dot">•</span>
        <span>PWA OFFLINE-FIRST</span>
        <span className="bru-landing__foot-dot">•</span>
        <span>v0.0.0 / FIELD·BOSQUE</span>
      </footer>
    </div>
  )
}

function CommandAccessDenied() {
  return (
    <div className="bru-app bru-landing bru-access-blocked">
      <div className="bru-landing__scan" aria-hidden="true" />
      <main className="bru-landing__main bru-access-blocked__main">
        <span className="bru-console__route">/command</span>
        <h1>Command center locked to host machine</h1>
        <p>
          This device can use the field client, but the command post is only
          available from the laptop running Brújula.
        </p>
        <Link to="/field" className="bru-access-blocked__link">
          Open field client
        </Link>
      </main>
    </div>
  )
}

function CommandRoute({ mode = 'post' }) {
  const [allowed, setAllowed] = useState(() => isLocalCommandHost(window.location.hostname))
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function checkCommandAccess() {
      try {
        const response = await fetch('/api/access/command', { cache: 'no-store' })
        if (!response.ok) throw new Error('command access check failed')
        const payload = await response.json()
        if (!cancelled) setAllowed(Boolean(payload?.data?.allowed))
      } catch {
        if (!cancelled) setAllowed(isLocalCommandHost(window.location.hostname))
      } finally {
        if (!cancelled) setChecked(true)
      }
    }

    checkCommandAccess()
    return () => {
      cancelled = true
    }
  }, [])

  if (!allowed && !checked) {
    return null
  }

  if (!allowed) return <CommandAccessDenied />

  return mode === 'graph' ? <CommandGraph /> : <CommandPost />
}

function App() {
  return (
    <>
      <IntroSplash />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/command" element={<CommandRoute />} />
          <Route path="/graph" element={<CommandRoute mode="graph" />} />
          <Route path="/field" element={<FieldClient />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
