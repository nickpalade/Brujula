import { useEffect, useRef, useState } from 'react';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import LanguagePicker from './LanguagePicker.jsx';

function SettingAction({ icon, label, detail, onClick }) {
  return (
    <button type="button" className="cmd-settings__action" onClick={onClick}>
      <Icon name={icon} />
      <span className="cmd-settings__action-copy">
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <span className="cmd-settings__arrow" aria-hidden="true">›</span>
    </button>
  );
}

function CommandSettings({ onConnectPhone, onRefresh, refreshing, density, onDensityChange }) {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const runAndClose = (action) => {
    setOpen(false);
    action?.();
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };

  return (
    <div className="cmd-settings" ref={rootRef}>
      <Button
        variant="default"
        className="cmd-settings__trigger"
        aria-label="Command post settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="settings" />
        Settings
      </Button>

      {open && (
        <section className="cmd-settings__panel" role="dialog" aria-label="Command post settings">
          <div className="cmd-settings__head">
            <div>
              <span className="cmd-settings__eyebrow">COMMAND POST</span>
              <h2>Settings</h2>
            </div>
            <button type="button" className="cmd-settings__close" aria-label="Close settings" onClick={() => setOpen(false)}>
              <Icon name="close" />
            </button>
          </div>

          <div className="cmd-settings__section">
            <span className="cmd-settings__section-title">Workspace</span>
            <div className="cmd-settings__field">
              <span>
                <strong>Language</strong>
                <small>Interface, AI summaries and SITREPs</small>
              </span>
              <LanguagePicker compact />
            </div>
            <div className="cmd-settings__field cmd-settings__field--stacked">
              <span>
                <strong>Display density</strong>
                <small>Choose how much operational data fits on screen</small>
              </span>
              <div className="cmd-settings__segments" aria-label="Display density">
                {['comfortable', 'compact'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={density === value}
                    className={density === value ? 'selected' : ''}
                    onClick={() => onDensityChange(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="cmd-settings__section">
            <span className="cmd-settings__section-title">Station</span>
            <SettingAction icon="phone" label="Connect a field phone" detail="Open the local QR handoff" onClick={() => runAndClose(onConnectPhone)} />
            <SettingAction icon="refresh" label={refreshing ? 'Syncing…' : 'Sync now'} detail="Pull the latest field and dispatch data" onClick={() => runAndClose(onRefresh)} />
            <SettingAction icon={fullscreen ? 'collapse' : 'expand'} label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} detail="Use the full display for the command board" onClick={() => runAndClose(toggleFullscreen)} />
          </div>

          <div className="cmd-settings__foot">
            <span className="cmd-settings__status-dot" />
            Local-first station · Settings saved on this device
          </div>
        </section>
      )}
    </div>
  );
}

export default CommandSettings;
