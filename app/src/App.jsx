import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'

import CommandPost from './command/CommandPost.jsx'
import FieldClient from './field/FieldClient.jsx'
import './App.css'

const STATIONS = [
  {
    index: '01',
    to: '/command',
    route: '/command',
    accent: 'command',
    title: 'Puesto de Mando',
    subtitle: 'Command Post',
    device: 'Portátil · Sala de operaciones',
    desc: 'Panorama completo de incidentes, despacho coordinado de recursos y avisos en tiempo real.',
  },
  {
    index: '02',
    to: '/field',
    route: '/field',
    accent: 'field',
    title: 'Cliente de Campo',
    subtitle: 'Field Client',
    device: 'Móvil · Primera línea',
    desc: 'Captura de reportes por voz y foto, cola sin conexión y recepción de asignaciones.',
  },
]

function Home() {
  return (
    <div className="bru-app bru-landing">
      <div className="bru-landing__scan" aria-hidden="true" />

      <header className="bru-landing__bar">
        <span className="bru-landing__brandmark">BRÚJULA</span>
        <span className="bru-landing__status">
          <i className="bru-landing__pulse" />
          SISTEMA OPERATIVO · SIN CONEXIÓN REQUERIDA
        </span>
      </header>

      <main className="bru-landing__main">
        <section className="bru-landing__hero">
          <img
            className="bru-landing__compass"
            src="/logo-animated.svg"
            alt="Brújula — aguja girando"
            width="132"
            height="132"
          />
          <div className="bru-landing__wordmark">
            <h1>
              BRÚ<span>JULA</span>
            </h1>
            <p className="bru-landing__tagline">
              Coordinación de emergencias que funciona{' '}
              <em>cuando la red no</em>.
            </p>
          </div>
        </section>

        <p className="bru-landing__prompt">
          <span className="bru-landing__prompt-tick">▸</span> Seleccione una
          estación para desplegar
        </p>

        <nav className="bru-landing__grid">
          {STATIONS.map((s, i) => (
            <Link
              key={s.to}
              to={s.to}
              className="bru-console"
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
                <span className="bru-console__subtitle">{s.subtitle}</span>
              </div>

              <p className="bru-console__desc">{s.desc}</p>

              <div className="bru-console__foot">
                <span className="bru-console__device">{s.device}</span>
                <span className="bru-console__enter">
                  ENTRAR <span className="bru-console__arrow">→</span>
                </span>
              </div>
            </Link>
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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/command" element={<CommandPost />} />
        <Route path="/field" element={<FieldClient />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
