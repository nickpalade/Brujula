import { useEffect, useRef, useState } from 'react';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import LanguagePicker from './LanguagePicker.jsx';
import { api } from '../shared/api.js';

function SettingAction({ icon, label, detail, onClick, disabled = false }) {
  return (
    <button type="button" className="cmd-settings__action" onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
      <span className="cmd-settings__action-copy">
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <span className="cmd-settings__arrow" aria-hidden="true">›</span>
    </button>
  );
}

function CommandSettings({ onConnectPhone, onOfflineMaps, onManageModels, onRefresh, refreshing, density, onDensityChange }) {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [dbBusy, setDbBusy] = useState(null); // 'export' | 'import' | 'reset' | null
  const [dbNote, setDbNote] = useState(null); // { tone: 'ok'|'err', text }
  const rootRef = useRef(null);
  const importInputRef = useRef(null);

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

  // ---- Database tools (testing/demo): export / import / reset snapshots ----

  const exportDb = async () => {
    setDbBusy('export');
    setDbNote(null);
    try {
      const blob = await api.exportDb();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `brujula-hub-${stamp}.db`;
      a.click();
      URL.revokeObjectURL(url);
      setDbNote({ tone: 'ok', text: 'Snapshot downloaded.' });
    } catch (err) {
      setDbNote({ tone: 'err', text: `Export failed: ${err.message}` });
    } finally {
      setDbBusy(null);
    }
  };

  const importDbFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-picking the same file later
    if (!file) return;
    setDbBusy('import');
    setDbNote(null);
    try {
      const result = await api.importDb(file);
      setDbNote({
        tone: 'ok',
        text: `Imported ${result.incidents} incidents, ${result.resources} resources. Reloading…`,
      });
      // Full reload: the sync cursor (seq) from the old board is stale now.
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setDbNote({ tone: 'err', text: `Import failed: ${err.message}` });
      setDbBusy(null);
    }
  };

  const wipeDb = async () => {
    const sure = window.confirm(
      'Start fresh? EVERYTHING will be deleted — reports, incidents, resources, dispatches, personnel, alerts and missing persons. The board starts completely empty (no demo data). Export a snapshot first if you want to keep this situation.',
    );
    if (!sure) return;
    setDbBusy('wipe');
    setDbNote(null);
    try {
      await api.wipeDb();
      setDbNote({ tone: 'ok', text: 'Board wiped clean. Reloading…' });
      // Full reload: the sync cursor (seq) restarts from zero.
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setDbNote({ tone: 'err', text: `Wipe failed: ${err.message}` });
      setDbBusy(null);
    }
  };

  const resetDb = async () => {
    const sure = window.confirm(
      'Reset the database? All current reports, incidents, resources and dispatches will be deleted and replaced with the seed scenario. Export a snapshot first if you want to keep this situation.',
    );
    if (!sure) return;
    setDbBusy('reset');
    setDbNote(null);
    try {
      await api.resetDb();
      setDbNote({ tone: 'ok', text: 'Board reset to seed scenario. Reloading…' });
      // Full reload: the sync cursor (seq) restarts from the seed writes.
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setDbNote({ tone: 'err', text: `Reset failed: ${err.message}` });
      setDbBusy(null);
    }
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
            <h2>Settings</h2>
            <button type="button" className="cmd-settings__close" aria-label="Close settings" onClick={() => setOpen(false)}>
              <Icon name="close" />
            </button>
          </div>

          <div className="cmd-settings__section">
            <div className="cmd-settings__field">
              <strong>Language</strong>
              <LanguagePicker compact />
            </div>
            {onDensityChange && (
              <div className="cmd-settings__field cmd-settings__field--stacked">
                <strong>Display density</strong>
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
            )}
          </div>

          <div className="cmd-settings__section">
            <span className="cmd-settings__section-title">Station</span>
            <SettingAction icon="phone" label="Connect a field phone" detail="Open the local QR handoff" onClick={() => runAndClose(onConnectPhone)} />
            <SettingAction icon="map" label="Offline maps" detail="Download map areas before going out" onClick={() => runAndClose(onOfflineMaps)} />
            {onManageModels && (
              <SettingAction icon="lab" label="Manage AI models" detail="Ollama models, downloads, GPU/CPU" onClick={() => runAndClose(onManageModels)} />
            )}
            <SettingAction icon="refresh" label={refreshing ? 'Syncing…' : 'Sync now'} detail="Pull the latest field and dispatch data" onClick={() => runAndClose(onRefresh)} />
            <SettingAction icon={fullscreen ? 'collapse' : 'expand'} label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} detail="Use the full display for the command board" onClick={() => runAndClose(toggleFullscreen)} />
          </div>

          <div className="cmd-settings__section">
            <span className="cmd-settings__section-title">Database · testing</span>
            <SettingAction
              icon="download"
              label={dbBusy === 'export' ? 'Exporting…' : 'Export database'}
              detail="Download the current board as a .db snapshot"
              onClick={exportDb}
              disabled={dbBusy !== null}
            />
            <SettingAction
              icon="upload"
              label={dbBusy === 'import' ? 'Importing…' : 'Import database'}
              detail="Replace the board with a .db snapshot"
              onClick={() => importInputRef.current?.click()}
              disabled={dbBusy !== null}
            />
            <SettingAction
              icon="refresh"
              label={dbBusy === 'reset' ? 'Resetting…' : 'Reset to seed scenario'}
              detail="Wipe the board and reload the demo fixtures"
              onClick={resetDb}
              disabled={dbBusy !== null}
            />
            <SettingAction
              icon="close"
              label={dbBusy === 'wipe' ? 'Wiping…' : 'Start fresh (empty board)'}
              detail="Delete everything — no demo data, blank situation"
              onClick={wipeDb}
              disabled={dbBusy !== null}
            />
            <input
              ref={importInputRef}
              type="file"
              accept=".db,application/octet-stream"
              style={{ display: 'none' }}
              onChange={importDbFile}
            />
            {dbNote && (
              <p className={`cmd-settings__db-note cmd-settings__db-note--${dbNote.tone}`} role="status">
                {dbNote.text}
              </p>
            )}
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
