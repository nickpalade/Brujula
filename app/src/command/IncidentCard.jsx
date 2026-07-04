import Card from '../shared/Card.jsx';
import Badge from '../shared/Badge.jsx';
import DecryptedText from '../vendor/DecryptedText.jsx';
import { CATEGORY_LABEL, URGENCY_LABEL, formatAge, isLiveVictim } from '../shared/urgency.js';

const STATUS_LABEL = {
  open: 'OPEN',
  dispatched: 'DISPATCHED',
  resolved: 'RESOLVED',
};

// Flat urgency glyphs — the bare symbol in the urgency color. Inline vector
// (no sprite crop, no plate, no background) so it stays crisp at any size.
const GLYPH_SHAPES = {
  critical: (
    <>
      <line x1="12" y1="4" x2="12" y2="14" />
      <line x1="12" y1="19.5" x2="12" y2="19.51" />
    </>
  ),
  high: (
    <>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5.5 11.5 12 5 18.5 11.5" />
    </>
  ),
  medium: <line x1="5" y1="12" x2="19" y2="12" />,
  low: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="5.5 12.5 12 19 18.5 12.5" />
    </>
  ),
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
      accented
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
      <div className="cmd-incident__layout">
        <span
          className="cmd-incident__glyph"
          data-urgency={incident.urgency}
          title={URGENCY_LABEL[incident.urgency] ?? incident.urgency}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {GLYPH_SHAPES[incident.urgency] ?? GLYPH_SHAPES.medium}
          </svg>
        </span>

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

          <p className="cmd-incident__summary">
            <DecryptedText
              text={incident.summary ?? ''}
              animateOn="view"
              sequential
              speed={14}
              encryptedClassName="cmd-incident__encrypted"
            />
          </p>

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
