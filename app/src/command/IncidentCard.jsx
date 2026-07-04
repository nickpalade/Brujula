import Card from '../shared/Card.jsx';
import Badge from '../shared/Badge.jsx';
import { CATEGORY_LABEL, URGENCY_LABEL, formatAge, isLiveVictim } from '../shared/urgency.js';

const STATUS_LABEL = {
  open: 'OPEN',
  dispatched: 'DISPATCHED',
  resolved: 'RESOLVED',
};

/*
 * IncidentCard — one line in the prioritized action feed.
 * Live-victim rescues get the alarm treatment (pulsing red glow + LIVE badge).
 * Escalated incidents show a pulsing red border + "Sin atender" badge.
 */
function IncidentCard({ incident, selected, hasProposal, escalated, onSelect }) {
  const live = isLiveVictim(incident);
  const dispatched = incident.status === 'dispatched';

  return (
    <Card
      urgency={incident.urgency}
      alarm={live && !dispatched}
      interactive
      selected={selected}
      onClick={() => onSelect?.(incident)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(incident);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${URGENCY_LABEL[incident.urgency] ?? incident.urgency}: ${incident.summary}`}
      className="cmd-incident"
      data-escalated={escalated?.escalated || false}
    >
      <div className="cmd-incident__top">
        <div className="cmd-incident__badges">
          <Badge urgency={incident.urgency} pulse={live && !dispatched} />
          <Badge variant="muted">{CATEGORY_LABEL[incident.category] ?? incident.category}</Badge>
          {live && (
            <Badge variant="critical" className="cmd-incident__live">
              ● LIVE VICTIMS
            </Badge>
          )}
          {escalated?.escalated && (
            <Badge variant="critical" pulse>
              {escalated.label}
            </Badge>
          )}
        </div>
        <span className="bru-meta cmd-incident__age" title={incident.created_at}>
          {formatAge(incident.created_at)}
        </span>
      </div>

      <p className="cmd-incident__summary">{incident.summary}</p>

      <div className="cmd-incident__foot">
        <span className="bru-meta" title="Location">
          <span aria-hidden="true">◎</span> {incident.location ?? 'Location unknown'}
        </span>
        {incident.people_count != null && (
          <span className="bru-meta" title="People affected">
            <span aria-hidden="true">◍</span> {incident.people_count} ppl
          </span>
        )}
        {dispatched ? (
          <Badge variant="ok" dot>
            {STATUS_LABEL.dispatched}
          </Badge>
        ) : hasProposal ? (
          <Badge variant="accent" dot>
            AI PROPOSAL
          </Badge>
        ) : incident.status === 'resolved' ? (
          <Badge variant="muted">{STATUS_LABEL.resolved}</Badge>
        ) : null}
      </div>
    </Card>
  );
}

export default IncidentCard;
