import { useEffect, useState } from 'react';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import { useI18n } from '../shared/i18n.jsx';

// AlertComposer — modal to broadcast an alert from Command Post.
// Message textarea, severity select (info/warning/critical), optional zone, send button.

function AlertComposer({ open, onClose, onSubmit }) {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState('warning');
  const [zone, setZone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ message, severity, zone: zone || null });
      setMessage('');
      setSeverity('warning');
      setZone('');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="cmd-modal-scrim" onClick={() => !busy && onClose?.()}>
      <div
        className="cmd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="broadcast-alert-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cmd-modal__head">
          <h2 id="broadcast-alert-title" className="cmd-modal__title">
            <Icon name="alert" />
            Broadcast Alert
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} aria-label="Close broadcast alert">
            <Icon name="close" />
          </Button>
        </div>

        <div className="cmd-modal__body cmd-form">
          <div className="cmd-form__field">
            <label className="cmd-form__label">
              Message
            </label>
            <textarea
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Tsunami warning for coastal areas"
              className="cmd-form__textarea"
            />
          </div>

          <div className="cmd-form__grid">
            <div className="cmd-form__field">
              <label className="cmd-form__label">
                Severity
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="cmd-select"
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div className="cmd-form__field">
              <label className="cmd-form__label">
                Zone (optional)
              </label>
              <input
                type="text"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="e.g. Catia La Mar"
                className="cmd-form__input"
              />
            </div>
          </div>
        </div>

        <div className="cmd-modal__foot">
          <div className="cmd-form__actions">
            <Button variant="default" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={!message.trim() || busy}>
              {!busy && <Icon name="alert" />}
              {busy ? 'Sending…' : 'Send Alert'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AlertComposer;
