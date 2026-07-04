// Report submission screen — mobile-first, thumb-reachable, one-handed.
// Big textarea, category quick-chips, optional people-count + location, giant
// SEND. Submitting hands the report to the outbox (store-and-forward), so it is
// saved locally first and flushed to the hub when reachable.

import { useState } from 'react'
import VoiceInput from './voice/VoiceInput.jsx'

// Incident.category vocabulary (CONTRACTS §2). "status" omitted from quick
// chips — a field responder reports needs/resources, status is rarely chip-tapped.
const CATEGORIES = [
  { id: 'rescue', label: 'Rescate' },
  { id: 'medical', label: 'Médico' },
  { id: 'water', label: 'Agua' },
  { id: 'shelter', label: 'Refugio' },
  { id: 'food', label: 'Comida' },
  { id: 'machinery', label: 'Maquinaria' },
  { id: 'hazard', label: 'Peligro' },
]

function ReportForm({ onSubmit }) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState(null)
  const [people, setPeople] = useState('')
  const [location, setLocation] = useState('')

  const canSend = text.trim().length > 0

  const handleSend = () => {
    if (!canSend) return
    onSubmit({
      text: text.trim(),
      category,
      people_count: people === '' ? null : Number(people),
      location: location.trim() || null,
    })
    setText('')
    setCategory(null)
    setPeople('')
    setLocation('')
  }

  const handleTranscript = (t) => {
    if (!t) return
    setText((prev) => (prev ? `${prev} ${t}` : t))
  }

  return (
    <div>
      <label className="field-label" htmlFor="report-text">
        ¿Qué está pasando?
      </label>
      <div className="textarea-wrap">
        <textarea
          id="report-text"
          className="report-textarea"
          placeholder="Ej: Edificio colapsado en Playa Grande, escuchamos voces, ~20 personas atrapadas, necesitamos maquinaria pesada."
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        <div className="mic-slot">
          <VoiceInput onTranscript={handleTranscript} />
        </div>
      </div>

      <span className="field-label">Categoría</span>
      <div className="chip-row">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip${category === c.id ? ' selected' : ''}`}
            onClick={() => setCategory(category === c.id ? null : c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="field-row" style={{ marginTop: 4 }}>
        <div>
          <label className="field-label" htmlFor="report-people">
            Personas
          </label>
          <input
            id="report-people"
            className="field-input"
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="—"
            value={people}
            onChange={(e) => setPeople(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="report-loc">
            Ubicación
          </label>
          <input
            id="report-loc"
            className="field-input"
            type="text"
            placeholder="Ej: Playa Grande"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>

      <button
        type="button"
        className="send-btn"
        onClick={handleSend}
        disabled={!canSend}
      >
        Enviar reporte
      </button>
    </div>
  )
}

export default ReportForm
