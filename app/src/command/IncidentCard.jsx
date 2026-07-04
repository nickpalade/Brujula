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
 */
function IncidentCard({ incident, selected, hasProposal, onSelect }) {
  const live = isLiveVictim(incident);
  const dispatched = incident.status === 'dispatched';

  return (
    <Card
      urgency={incident.urgency}
      accented
      alarm={live && !dispatched}
      interactive
      selected={selected}
      onClick={() => onSelect?.(incident)}
      className="cmd-incident"
    >
      <div className="cmd-incident__layout">
        <span
          className="cmd-incident__glyph"
          data-urgency={incident.urgency}
          title={URGENCY_LABEL[incident.urgency] ?? incident.urgency}
          aria-hidden="true"
        />

        <div className="cmd-incident__body">
          <div className="cmd-incident__top">
            <div className="cmd-incident__badges">
              <Badge urgency={incident.urgency} pulse={live && !dispatched} />
              <Badge variant="muted">{CATEGORY_LABEL[incident.category] ?? incident.category}</Badge>
              {live && (
                <Badge variant="critical" className="cmd-incident__live">
                  ● LIVE VICTIMS
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
        </div>
      </div>
    </Card>
  );
}

export default IncidentCard;
