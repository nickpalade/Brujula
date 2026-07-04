// First-open role selection (PRD §5C extension): the device signs up as a
// reporter (only reports what's happening), a volunteer team, or a
// specialized crew. Volunteers/crews are registered on the hub as available
// resources, so the agent's match step can propose dispatching them.
//
// The first choice is the language: picking it re-renders this whole screen in
// the chosen language immediately (via the app i18n context).

import { useState } from 'react'
import { LANGUAGES } from '../shared/languages.js'
import { useI18n } from '../shared/i18n.jsx'
import DotGrid from '../vendor/DotGrid.jsx'

const ROLE_IDS = ['reporter', 'volunteer', 'crew']
const SKILL_IDS = ['rescue', 'medical', 'water', 'shelter', 'food', 'machinery']

function makeDeviceId() {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function Onboarding({ onComplete }) {
  const { lang, setLang, t } = useI18n()
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
      lang,
      skill: needsSkill ? skill : null,
      location: location.trim() || null,
      team_size: showTeamFields && teamSize ? parseInt(teamSize, 10) : null,
      device_id: makeDeviceId(),
    })
  }

  return (
    <div className="onboard">
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
      <h2 className="onboard-title">{t('ob.welcome')}</h2>
      <p className="onboard-sub">{t('ob.langIntro')}</p>

      <label className="field-label" htmlFor="ob-lang">
        {t('lang.label')}
      </label>
      <select
        id="ob-lang"
        className="field-input onboard-lang"
        value={lang}
        onChange={(e) => setLang(e.target.value)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>

      <h2 className="onboard-title" style={{ marginTop: 28 }}>
        {t('ob.whoTitle')}
      </h2>
      <p className="onboard-sub">{t('ob.whoSub')}</p>

      <div className="role-cards">
        {ROLE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`role-card${role === id ? ' selected' : ''}`}
            onClick={() => setRole(id)}
          >
            <span className="role-card-title">{t(`role.${id}.title`)}</span>
            <span className="role-card-desc">{t(`role.${id}.desc`)}</span>
          </button>
        ))}
      </div>

      {role && (
        <>
          <label className="field-label" htmlFor="ob-name">
            {role === 'reporter' ? t('ob.nameReporter') : t('ob.nameTeam')}
          </label>
          <input
            id="ob-name"
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={role === 'reporter' ? t('ob.namePhReporter') : t('ob.namePhTeam')}
            autoComplete="off"
          />

          {needsSkill && (
            <>
              <span className="field-label">{t('ob.specialty')}</span>
              <div className="chip-row">
                {SKILL_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`chip${skill === id ? ' selected' : ''}`}
                    onClick={() => setSkill(id)}
                  >
                    {t(`cat.${id}`)}
                  </button>
                ))}
              </div>
            </>
          )}

          {showTeamFields && (
            <div className="field-row" style={{ marginTop: 18 }}>
              <div>
                <label className="field-label" htmlFor="ob-size">
                  {t('ob.people')}
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
                  {t('ob.where')}
                </label>
                <input
                  id="ob-loc"
                  className="field-input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t('ob.wherePh')}
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          <button type="button" className="send-btn" disabled={!ready} onClick={start}>
            {t('ob.start')}
          </button>
        </>
      )}
    </div>
  )
}

export default Onboarding
