// Settings → Manage AI models — the hub's Ollama admin, in the command UI.
// Same capabilities as the server test page (server/static/index.html):
// backend health + GPU/CPU compute toggle, installed models (activate/delete),
// recommended models with background pull progress, and a custom-pull input.
// All state lives on the hub; this modal just polls it.

import { useCallback, useEffect, useState } from 'react';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import Badge from '../shared/Badge.jsx';
import {
  getModelHealth,
  getModels,
  getRecommendedModels,
  getModelConfig,
  setActiveModel,
  pullModel,
  getPullStatus,
  clearPullStatus,
  deleteModel,
  setComputeMode,
} from './dataSource.js';

const POLL_MS = 1500;

function DownloadBar({ progress }) {
  return (
    <div className="cmd-ollama__bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
      <div className="cmd-ollama__bar-fill" style={{ width: `${progress}%` }} />
    </div>
  );
}

function OllamaModal({ open, onClose }) {
  const [health, setHealth] = useState(null); // GET /health payload
  const [installed, setInstalled] = useState([]); // [{ name, size }]
  const [recommended, setRecommended] = useState([]); // [{ name, size, note, installed }]
  const [activeModel, setActiveModelName] = useState(null);
  const [downloads, setDownloads] = useState({}); // { [name]: { status, progress, error } }
  const [customName, setCustomName] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // Health first and separately: the model list 503s while Ollama is
      // down, but the health card should still explain what's wrong.
      const h = await getModelHealth();
      setHealth(h);
      setLoadError(null);
      const [models, rec, cfg, pulls] = await Promise.all([
        getModels().catch(() => null),
        getRecommendedModels(),
        getModelConfig().catch(() => null),
        getPullStatus(),
      ]);
      setInstalled(models?.models ?? []);
      setRecommended(rec?.models ?? []);
      setActiveModelName(cfg?.active ?? h.model ?? null);
      const dl = pulls?.downloads ?? {};
      setDownloads(dl);
      // Finished pulls: clear their status entries so retried/queued rows reset.
      for (const [name, d] of Object.entries(dl)) {
        if (d.status === 'complete') clearPullStatus(name).catch(() => {});
      }
    } catch (e) {
      setLoadError(e.message || 'hub unreachable');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setActionError(null);
    setLoaded(false);
    refresh();
    return undefined;
  }, [open, refresh]);

  // Poll while any pull is in flight so progress bars move.
  const downloading = Object.values(downloads).some((d) => d.status === 'downloading');
  useEffect(() => {
    if (!open || !downloading) return undefined;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [open, downloading, refresh]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const run = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setActionError(e.message || 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const handleUse = (name) => run(() => setActiveModel(name));
  const handlePull = (name) => run(() => pullModel(name));
  const handleDelete = (name) => {
    if (!window.confirm(`Delete ${name} from this laptop?`)) return;
    run(() => deleteModel(name));
  };
  const handleCompute = (mode) => {
    if (mode === health?.compute_mode) return;
    run(() => setComputeMode(mode));
  };
  const handlePullCustom = () => {
    const name = customName.trim();
    if (!name) return;
    setCustomName('');
    handlePull(name);
  };

  const reachable = Boolean(health?.ollama_reachable);
  // Pulls tracked by name but absent from the recommended list (custom pulls).
  const recNames = new Set(recommended.map((m) => m.name));
  const customPulls = Object.entries(downloads).filter(
    ([name, d]) => !recNames.has(name) && d.status !== 'complete',
  );

  return (
    <div className="cmd-modal-scrim" onClick={onClose}>
      <div
        className="cmd-modal cmd-ollama"
        role="dialog"
        aria-modal="true"
        aria-label="Manage AI models"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cmd-modal__head">
          <span className="bru-panel__title">
            <Icon name="lab" />
            Manage AI models
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Icon name="close" />
            Close
          </Button>
        </header>

        <div className="cmd-modal__body cmd-ollama__body">
          <p className="cmd-ollama__lead">
            The hub runs its AI fully on this laptop through Ollama. Download models{' '}
            <strong>before going out to the disaster</strong> — switching and parsing work with
            zero internet afterwards.
          </p>

          {!loaded ? (
            <div className="bru-empty">
              <span>Checking the hub's AI backend…</span>
            </div>
          ) : loadError ? (
            <div className="cmd-ollama__warn">
              AI backend status unavailable ({loadError}).
            </div>
          ) : (
            <>
              <div className="cmd-ollama__status">
                <Badge variant={reachable ? 'ok' : 'critical'} dot>
                  {reachable ? 'Ollama running' : 'Ollama down'}
                </Badge>
                <span className="bru-meta">
                  active model: <strong>{activeModel || 'none'}</strong>
                </span>
                <span className="cmd-ollama__spacer" />
                <span className="bru-meta">compute:</span>
                <div className="cmd-settings__segments cmd-ollama__segments" aria-label="Compute mode">
                  {['gpu', 'cpu'].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={busy}
                      aria-pressed={health?.compute_mode === mode}
                      className={health?.compute_mode === mode ? 'selected' : ''}
                      onClick={() => handleCompute(mode)}
                    >
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {!reachable && (
                <div className="cmd-ollama__warn">
                  <strong>Ollama isn't reachable.</strong> Model downloads and switching won't work
                  until the backend is back ({health?.detail || 'no detail'}).
                </div>
              )}
              {actionError && <div className="cmd-ollama__warn">{actionError}</div>}

              <div className="cmd-ollama__section">
                <span className="cmd-settings__section-title">Installed models</span>
                {installed.length === 0 ? (
                  <div className="bru-empty">
                    <span>No models installed yet. Download one below to enable report parsing.</span>
                  </div>
                ) : (
                  <ul className="cmd-ollama__list">
                    {installed.map((m) => (
                      <li key={m.name} className="cmd-ollama__row">
                        <div className="cmd-ollama__row-main">
                          <span className="cmd-ollama__name">{m.name}</span>
                          <span className="bru-meta">{m.size}</span>
                        </div>
                        {m.name === activeModel ? (
                          <Badge variant="ok" dot>
                            active
                          </Badge>
                        ) : (
                          <Button variant="default" size="sm" disabled={busy || !reachable} onClick={() => handleUse(m.name)}>
                            Use
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || !reachable}
                          aria-label={`Delete ${m.name}`}
                          onClick={() => handleDelete(m.name)}
                        >
                          <Icon name="trash" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="cmd-ollama__section">
                <span className="cmd-settings__section-title">Get more models</span>
                <ul className="cmd-ollama__list">
                  {recommended.map((m) => {
                    const dl = downloads[m.name];
                    return (
                      <li key={m.name} className="cmd-ollama__row">
                        <div className="cmd-ollama__row-main">
                          <span className="cmd-ollama__name">{m.name}</span>
                          <span className="bru-meta">
                            {m.size} · {m.note}
                          </span>
                        </div>
                        {m.installed ? (
                          <Badge variant="muted">installed</Badge>
                        ) : dl?.status === 'downloading' ? (
                          <div className="cmd-ollama__dl">
                            <DownloadBar progress={dl.progress ?? 0} />
                            <span className="bru-meta">{dl.progress ?? 0}%</span>
                          </div>
                        ) : dl?.status === 'error' ? (
                          <>
                            <span className="cmd-ollama__err">{dl.error}</span>
                            <Button variant="default" size="sm" disabled={busy || !reachable} onClick={() => handlePull(m.name)}>
                              Retry
                            </Button>
                          </>
                        ) : (
                          <Button variant="primary" size="sm" disabled={busy || !reachable} onClick={() => handlePull(m.name)}>
                            <Icon name="download" />
                            Download
                          </Button>
                        )}
                      </li>
                    );
                  })}
                  {customPulls.map(([name, d]) => (
                    <li key={name} className="cmd-ollama__row">
                      <div className="cmd-ollama__row-main">
                        <span className="cmd-ollama__name">{name}</span>
                      </div>
                      {d.status === 'downloading' ? (
                        <div className="cmd-ollama__dl">
                          <DownloadBar progress={d.progress ?? 0} />
                          <span className="bru-meta">{d.progress ?? 0}%</span>
                        </div>
                      ) : (
                        <span className="cmd-ollama__err">{d.error}</span>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="cmd-ollama__custom">
                  <input
                    type="text"
                    value={customName}
                    placeholder="any Ollama model, e.g. qwen2.5:3b"
                    disabled={busy || !reachable}
                    onChange={(e) => setCustomName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePullCustom()}
                  />
                  <Button variant="default" size="sm" disabled={busy || !reachable || !customName.trim()} onClick={handlePullCustom}>
                    <Icon name="download" />
                    Download
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default OllamaModal;
