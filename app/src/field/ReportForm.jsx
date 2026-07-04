// Report submission screen — mobile-first, thumb-reachable, one-handed.
// Big textarea, category quick-chips, optional photo (compressed on-device,
// parsed by multimodal Gemma), optional people-count + location, giant SEND.
// Submitting hands the report to the outbox (store-and-forward), so it is
// saved locally first and flushed to the hub when reachable.

import { useEffect, useRef, useState } from 'react'
import VoiceInput from './voice/VoiceInput.jsx'
import { fileToCompressedPhoto } from './photo.js'

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
  const [photo, setPhoto] = useState(null) // { base64, mime, previewUrl }
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const fileRef = useRef(null)
  // Best-effort phone GPS, attached to the report when the browser grants it.
  // On the hub's plain-HTTP LAN origin most browsers deny geolocation — that
  // failure is silent by design (the hub's gazetteer still maps the report
  // from its location text). Refreshed after every send so the NEXT report
  // carries a current fix.
  const [coords, setCoords] = useState(null)
  const coordsRef = useRef(null)

  const captureGps = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        }
        coordsRef.current = c
        setCoords(c)
      },
      () => {}, // denied / unavailable / insecure origin — silently no GPS
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  }

  useEffect(() => {
    captureGps()
  }, [])

  // A photo alone is a valid report — the hub parses photo-only submissions.
  const canSend = text.trim().length > 0 || Boolean(photo)

  const handlePhotoPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      setPhoto(await fileToCompressedPhoto(file))
    } catch (err) {
      setPhotoError(err.message || 'no se pudo procesar la foto')
    } finally {
      setPhotoBusy(false)
    }
  }

  const handleSend = () => {
    if (!canSend || photoBusy) return
    const gps = coordsRef.current
    onSubmit({
      text: text.trim(),
      category,
      people_count: people === '' ? null : Number(people),
      location: location.trim() || null,
      image_base64: photo?.base64 ?? null,
      image_mime: photo?.mime ?? null,
      lat: gps?.lat ?? null,
      lon: gps?.lon ?? null,
      accuracy: gps?.accuracy ?? null,
    })
    setText('')
    setCategory(null)
    setPeople('')
    setLocation('')
    setPhoto(null)
    setPhotoError(null)
    captureGps()
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

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handlePhotoPick}
      />
      {photo ? (
        <div className="photo-preview">
          <img src={photo.previewUrl} alt="Foto adjunta al reporte" />
          <div className="photo-preview-meta">
            <span>Foto adjunta — el agente la analizará</span>
            <button type="button" className="link-btn" onClick={() => setPhoto(null)}>
              quitar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="photo-btn"
          disabled={photoBusy}
          onClick={() => fileRef.current?.click()}
        >
          {photoBusy ? 'Procesando foto…' : '📷 Añadir foto (opcional)'}
        </button>
      )}
      {photoError && <div className="photo-error">{photoError}</div>}

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

      {coords && (
        <div className="gps-chip">
          Ubicación GPS adjunta
          {Number.isFinite(coords.accuracy) ? ` (±${Math.round(coords.accuracy)} m)` : ''}
        </div>
      )}

      <button
        type="button"
        className="send-btn"
        onClick={handleSend}
        disabled={!canSend || photoBusy}
      >
        Enviar reporte
      </button>
    </div>
  )
}

export default ReportForm
