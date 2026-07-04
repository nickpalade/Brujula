import { useState } from 'react';
import Card from '../shared/Card.jsx';
import Badge from '../shared/Badge.jsx';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';

/*
 * DispatchProposal — the money shot (PRD §4.2 step 6, human-in-command).
 * "AI proposes: [resource] -> [incident]" + rationale, with CONFIRM / OVERRIDE.
 * Override opens an inline resource picker (available resources only).
 */
function DispatchProposal({
  dispatch,
  incident,
  resource,
  availableResources = [],
  onConfirm,
  onOverride,
  busy = false,
}) {
  const [overriding, setOverriding] = useState(false);
  const [pick, setPick] = useState('');

  if (!dispatch) return null;

  const confirmed = dispatch.state === 'confirmed' || dispatch.state === 'done';

  if (confirmed) {
    return (
      <Card className="cmd-proposal cmd-proposal--confirmed">
        <div className="cmd-proposal__head">
          <Badge variant="ok" dot>
            DISPATCH CONFIRMED
          </Badge>
        </div>
        <p className="cmd-proposal__line">
          <strong>{resource?.label ?? dispatch.resource_id}</strong>
          <span className="cmd-proposal__arrow"> → </span>
          <strong>{incident?.location ?? incident?.summary ?? dispatch.incident_id}</strong>
        </p>
        <p className="cmd-proposal__meta bru-meta">
          Confirmed by coordinator · resource committed
        </p>
      </Card>
    );
  }

  return (
    <Card className="cmd-proposal" accented urgency={incident?.urgency}>
      <div className="cmd-proposal__head">
        <Badge variant="accent" dot pulse>
          AI PROPOSES DISPATCH
        </Badge>
        {dispatch.proposed_by_ai === false && (
          <Badge variant="muted">manual</Badge>
        )}
      </div>

      <p className="cmd-proposal__line">
        <strong>{resource?.label ?? dispatch.resource_id}</strong>
        {resource?.location && (
          <span className="bru-meta"> · {resource.location}</span>
        )}
        <span className="cmd-proposal__arrow"> → </span>
        <strong>{incident?.location ?? incident?.summary ?? dispatch.incident_id}</strong>
      </p>

      {dispatch.rationale && (
        <p className="cmd-proposal__rationale">
          <span className="cmd-proposal__rationale-label">RATIONALE</span>
          {dispatch.rationale}
        </p>
      )}

      {!overriding ? (
        <div className="cmd-proposal__actions">
          <Button
            variant="confirm"
            onClick={() => onConfirm?.(dispatch)}
            disabled={busy}
          >
            {!busy && <Icon name="check" />}
            {busy ? 'CONFIRMING…' : 'CONFIRM'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setOverriding(true)}
            disabled={busy}
          >
            OVERRIDE
          </Button>
        </div>
      ) : (
        <div className="cmd-proposal__override">
          <label className="cmd-proposal__override-label">
            Reassign to resource
          </label>
          <select
            className="cmd-select"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">Select resource…</option>
            {availableResources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — {r.location}
              </option>
            ))}
          </select>
          <div className="cmd-proposal__actions">
            <Button
              variant="primary"
              size="sm"
              disabled={!pick || busy}
              onClick={() => {
                onOverride?.(dispatch, pick);
                setOverriding(false);
                setPick('');
              }}
            >
              CONFIRM OVERRIDE
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOverriding(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default DispatchProposal;
