import { useEffect, useState } from 'react';
import Button from '../shared/Button.jsx';

/*
 * SitrepModal — renders the generated situation-report text in a copyable
 * modal. Shows a live loading state (a model call can take a few seconds).
 */
function SitrepModal({ open, loading, sitrep, error, onClose, onRegenerate }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    setCopied(false);
  }, [sitrep, open]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sitrep?.text ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="cmd-modal-scrim" onClick={onClose}>
      <div
        className="cmd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Situation report"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cmd-modal__head">
          <span className="bru-panel__title">▤ SITREP — Situation Report</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕ Close
          </Button>
        </header>

        <div className="cmd-modal__body">
          {loading ? (
            <div className="cmd-sitrep-loading">
              <span className="cmd-spinner" aria-hidden="true" />
              Generating situation report from the current board…
            </div>
          ) : error ? (
            <div className="bru-empty">
              <strong>Sitrep unavailable</strong>
              <span>{error}</span>
            </div>
          ) : (
            <pre className="cmd-sitrep-text">{sitrep?.text}</pre>
          )}
        </div>

        <footer className="cmd-modal__foot">
          <span className="bru-meta">
            {sitrep?.generated_at ? `Generated ${sitrep.generated_at}` : ''}
          </span>
          <div className="cmd-modal__foot-actions">
            <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={loading}>
              ↻ Regenerate
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={copy}
              disabled={loading || !sitrep?.text}
            >
              {copied ? '✓ Copied' : '⧉ Copy'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default SitrepModal;
