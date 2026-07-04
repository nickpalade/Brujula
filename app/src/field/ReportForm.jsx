// Report submission screen — mobile-first, thumb-reachable, one-handed.
// Big textarea, category quick-chips, optional photo (compressed on-device,
// parsed by multimodal Gemma), optional people-count + location, giant SEND.
// Submitting hands the report to the outbox (store-and-forward), so it is
// saved locally first and flushed to the hub when reachable.

import { useRef, useState } from 'react'
import Icon from '../shared/Icon.jsx'
import { useI18n } from '../shared/i18n.jsx'
import VoiceInput from './voice/VoiceInput.jsx'
import { fileToCompressedPhoto } from './photo.js'

// Incident.category vocabulary (CONTRACTS §2). "status" omitted from quick
// chips — a field responder reports needs/resources, status is rarely chip-tapped.
// Labels are looked up via t(`cat.${id}`) so they follow the display language.
const CATEGORY_IDS = ['rescue', 'medical', 'water', 'shelter', 'food', 'machinery', 'hazard']

function ReportForm({ onSubmit }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [category, setCategory] = useState(null)
  const [people, setPeople] = useState('')
  const [location, setLocation] = useState('')
  const [photo, setPhoto] = useState(null) // { base64, mime, previewUrl }
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const fileRef = useRef(null)

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
      setPhotoError(err.message || t('rf.photoError'))
    } finally {
      setPhotoBusy(false)
    }
  }

  const handleSend = () => {
    if (!canSend || photoBusy) return
    onSubmit({
      text: text.trim(),
      category,
      people_count: people === '' ? null : Number(people),
      location: location.trim() || null,
      image_base64: photo?.base64 ?? null,
      image_mime: photo?.mime ?? null,
    })
    setText('')
    setCategory(null)
    setPeople('')
    setLocation('')
    setPhoto(null)
    setPhotoError(null)
  }

  const handleTranscript = (t) => {
    if (!t) return
    setText((prev) => (prev ? `${prev} ${t}` : t))
  }

  return (
    <div>
      <label className="field-label" htmlFor="report-text">
        {t('rf.what')}
      </label>
      <div className="textarea-wrap">
        <textarea
          id="report-text"
          className="report-textarea"
          placeholder={t('rf.placeholder')}
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
          <img src={photo.previewUrl} alt={t('rf.photoAlt')} />
          <div className="photo-preview-meta">
            <span>{t('rf.photoAttached')}</span>
            <button type="button" className="link-btn" onClick={() => setPhoto(null)}>
              {t('rf.photoRemove')}
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
          {!photoBusy && <Icon name="photo" />}
          {photoBusy ? t('rf.photoBusy') : t('rf.photoAdd')}
        </button>
      )}
      {photoError && <div className="photo-error">{photoError}</div>}

      <span className="field-label">{t('rf.category')}</span>
      <div className="chip-row">
        {CATEGORY_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`chip${category === id ? ' selected' : ''}`}
            onClick={() => setCategory(category === id ? null : id)}
          >
            {t(`cat.${id}`)}
          </button>
        ))}
      </div>

      <div className="field-row" style={{ marginTop: 4 }}>
        <div>
          <label className="field-label" htmlFor="report-people">
            {t('rf.people')}
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
            {t('rf.location')}
          </label>
          <input
            id="report-loc"
            className="field-input"
            type="text"
            placeholder={t('rf.locationPh')}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>

      <button
        type="button"
        className="send-btn"
        onClick={handleSend}
        disabled={!canSend || photoBusy}
      >
        {t('rf.send')}
      </button>
    </div>
  )
}

export default ReportForm
