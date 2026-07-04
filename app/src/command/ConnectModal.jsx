import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/*
 * ConnectModal — "Connect a phone" helper for the command center.
 *
 * Shows a QR code (and copyable link) that points a field responder's phone at
 * the field client. The URL comes from the hub's network-info endpoint, so it
 * uses the LAN address even when the operator opened Command on localhost.
 */
function ConnectModal({ open, onClose }) {
  const [copied, setCopied] = useState(false);
  const [lanOrigin, setLanOrigin] = useState('');

  const fieldUrl = useMemo(() => {
    if (lanOrigin) return `${lanOrigin}/field`;
    if (typeof window === 'undefined') return '';
    if (LOCAL_HOSTNAMES.has(window.location.hostname)) return '';
    return `${window.location.origin}/field`;
  }, [lanOrigin]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    fetch('/api/network-info', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        const origin = body?.data?.lan_origin;
        if (typeof origin === 'string' && origin) setLanOrigin(origin.replace(/\/$/, ''));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    setCopied(false);
  }, [open]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fieldUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="cmd-modal-scrim" onClick={onClose}>
      <div
        className="cmd-modal cmd-connect"
        role="dialog"
        aria-modal="true"
        aria-label="Connect a phone"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cmd-modal__head">
          <span className="bru-panel__title">
            <Icon name="phone" />
            Connect a phone
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Icon name="close" />
            Close
          </Button>
        </header>

        <div className="cmd-modal__body cmd-connect__body">
          <p className="cmd-connect__lead">
            Scan this code with a phone camera to open the field reporting app.
          </p>

          <div className="cmd-connect__qr">
            {fieldUrl ? (
              <QRCodeSVG value={fieldUrl} size={224} level="M" marginSize={2} />
            ) : (
              <span className="cmd-connect__pending">Preparing network link...</span>
            )}
          </div>

          <div className="cmd-connect__linkrow">
            <code className="cmd-connect__link">{fieldUrl || 'Preparing network link...'}</code>
            <Button variant="primary" size="sm" onClick={copy} disabled={!fieldUrl}>
              <Icon name={copied ? 'check' : 'copy'} />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default ConnectModal;
