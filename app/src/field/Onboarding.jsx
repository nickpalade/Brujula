// First-open role selection (PRD §5C extension): the device signs up as a
// reporter (only reports what's happening), a volunteer team, or a
// specialized crew. Volunteers/crews are registered on the hub as available
// resources, so the agent's match step can propose dispatching them.

import { useState } from 'react'
import DotGrid from '../vendor/DotGrid.jsx'

const ROLES = [
  {
    id: 'reporter',
    title: 'Reportero',
    desc: 'Solo informo lo que está pasando a mi alrededor.',
  },
  {
    id: 'volunteer',
    title: 'Voluntario',
    desc: 'Puedo ayudar con trabajo general: refugios, reparto, apoyo.',
  },
  {
    id: 'crew',
    title: 'Equipo especializado',
    desc: 'Somos un equipo con una capacidad concreta (rescate, médico…).',
  },
]

const SKILLS = [
  { id: 'rescue', label: 'Rescate' },
  { id: 'medical', label: 'Médico' },
  { id: 'water', label: 'Agua' },
  { id: 'shelter', label: 'Refugio' },
  { id: 'food', label: 'Comida' },
  { id: 'machinery', label: 'Maquinaria' },
]

function makeDeviceId() {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function Onboarding({ onComplete }) {
  const [role, setRole] = useState(null)
  const [name, setName] = useState('')
  const [skill, setSkill] = useState(null)
  const [location, setLocation] = useState('')
  const [teamSize, setTeamSize] = useState('')

  const needsSkill = role === 'crew'
  const showTeamFields = role === 'volunteer' || role === 'crew'
  const ready = role && name.trim().length > 0 && (!needsSkill || skill)

  const start = () => {
    if (!ready) return
    onComplete({
      role,
      name: name.trim(),
      skill: needsSkill ? skill : null,
      location: location.trim() || null,
      team_size: showTeamFields && teamSize ? parseInt(teamSize, 10) : null,
      device_id: makeDeviceId(),
    })
  }

  return (
    <div className="onboard">
      {/* Ambient dot field, Bosque-toned; dots warm to garnet near the finger
          and shockwave on tap. First-open only — unmounts after signup. */}
      <div className="onboard-dots" aria-hidden="true">
        <DotGrid
          dotSize={3}
          gap={18}
          baseColor="#22332a"
          activeColor="#b03a46"
          proximity={90}
          shockRadius={180}
          shockStrength={4}
          resistance={600}
          returnDuration={1.2}
        />
      </div>
      <h2 className="onboard-title">¿Quién eres en el terreno?</h2>
      <p className="onboard-sub">
        Esto le dice al puesto de mando qué puedes hacer. Se puede cambiar
        después.
      </p>

      <div className="role-cards">
        {ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`role-card${role === r.id ? ' selected' : ''}`}
            onClick={() => setRole(r.id)}
          >
            <span className="role-card-title">{r.title}</span>
            <span className="role-card-desc">{r.desc}</span>
          </button>
        ))}
      </div>

      {role && (
        <>
          <label className="field-label" htmlFor="ob-name">
            {role === 'reporter' ? 'Tu nombre' : 'Nombre del equipo o responsable'}
          </label>
          <input
            id="ob-name"
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={role === 'reporter' ? 'Ej: María P.' : 'Ej: Cuadrilla Delta'}
            autoComplete="off"
          />

          {needsSkill && (
            <>
              <span className="field-label">Especialidad</span>
              <div className="chip-row">
                {SKILLS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip${skill === s.id ? ' selected' : ''}`}
                    onClick={() => setSkill(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {showTeamFields && (
            <div className="field-row" style={{ marginTop: 18 }}>
              <div>
                <label className="field-label" htmlFor="ob-size">
                  Personas
                </label>
                <input
                  id="ob-size"
                  className="field-input"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={teamSize}
                  onChange={(e) => setTeamSize(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="ob-loc">
                  Dónde están
                </label>
                <input
                  id="ob-loc"
                  className="field-input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Ej: Caraballeda"
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          <button type="button" className="send-btn" disabled={!ready} onClick={start}>
            Comenzar
          </button>
        </>
      )}
    </div>
  )
}

export default Onboarding
