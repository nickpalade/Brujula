import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';

/*
 * ConnectModal — "Connect a phone" helper for the command center.
 *
 * Shows a QR code (and copyable link) that points a field responder's phone at
 * the field client. The URL is derived from the page the command post is served
 * from (window.location.origin + /field), so whatever address the operator
 * opened the console on — typically the hub's LAN IP — the QR points phones at
 * the right place with no manual IP entry.
 *
 * Caveat: if the console itself is opened on localhost, phones on the LAN can't
 * reach it, so we surface a warning telling the operator to reopen the console
 * via the machine's network IP.
 */
function ConnectModal({ open, onClose }) {
  const [copied, setCopied] = useState(false);

  const { fieldUrl, isLocal } = useMemo(() => {
    if (typeof window === 'undefined') return { fieldUrl: '', isLocal: false };
    const { origin, hostname } = window.location;
    return {
      fieldUrl: `${origin}/field`,
      isLocal: hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]',
    };
  }, []);

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
            <QRCodeSVG value={fieldUrl} size={224} level="M" marginSize={2} />
          </div>

          <div className="cmd-connect__linkrow">
            <code className="cmd-connect__link">{fieldUrl}</code>
            <Button variant="primary" size="sm" onClick={copy}>
              <Icon name={copied ? 'check' : 'copy'} />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>

          {isLocal && (
            <div className="cmd-connect__warn">
              <strong>Heads up:</strong> this console is open on{' '}
              <code>localhost</code>, which phones on your network can't reach.
              Reopen the command center using this computer's network IP address
              (e.g. <code>http://10.0.0.5:8000/command</code>), then this QR code
              will point phones to the right place.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConnectModal;
