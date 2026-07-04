import Badge from '../shared/Badge.jsx';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import './alert-strip.css';

// AlertStrip — compact display of active alerts at the top of the page.
// Each alert shows severity-colored badge + message, with a deactivate control.

const SEVERITY_VARIANT = {
  info: 'accent',
  warning: 'warn',
  critical: 'critical',
};

function AlertStrip({ alerts, onDeactivate }) {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="cmd-alert-strip">
      <div className="cmd-alert-strip__content">
        {alerts.map((alert) => (
          <div key={alert.id} className="cmd-alert-item" data-severity={alert.severity}>
            <Badge variant={SEVERITY_VARIANT[alert.severity] || 'muted'} dot className="cmd-alert-item__badge">
              {alert.severity.toUpperCase()}
            </Badge>
            <span className="cmd-alert-item__message">{alert.message}</span>
            {alert.zone && <span className="cmd-alert-item__zone">{'·'} {alert.zone}</span>}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeactivate(alert.id)}
              className="cmd-alert-item__close"
              aria-label={`Deactivate alert: ${alert.message}`}
              title="Deactivate alert"
            >
              <Icon name="close" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AlertStrip;
