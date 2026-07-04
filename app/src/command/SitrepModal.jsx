import { useEffect, useMemo, useState } from 'react';
import Badge from '../shared/Badge.jsx';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';

/*
 * SitrepModal — turns the current board into a command briefing, while keeping
 * the generated model narrative available for copy/export.
 */
const URGENCY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const ACTIVE_DISPATCH_STATES = new Set(['confirmed', 'accepted', 'en_route', 'on_site']);

function formatTime(value) {
  if (!value) return 'unknown time';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAge(value) {
  if (!value) return 'age unknown';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'age unknown';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m old`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m old` : `${hours}h old`;
}

function sortIncidents(incidents) {
  return [...incidents].sort((a, b) => {
    const urgency = (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0);
    if (urgency !== 0) return urgency;
    const people = (b.people_count ?? 0) - (a.people_count ?? 0);
    if (people !== 0) return people;
    return new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0);
  });
}

function indexById(items) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function getDispatchTone(dispatch) {
  if (!dispatch) return { label: 'unmatched', variant: 'critical' };
  if (dispatch.state === 'proposed') return { label: 'awaiting confirmation', variant: 'accent' };
  if (ACTIVE_DISPATCH_STATES.has(dispatch.state)) return { label: dispatch.state.replace('_', ' '), variant: 'ok' };
  if (dispatch.state === 'done') return { label: 'done', variant: 'muted' };
  return { label: dispatch.state, variant: 'muted' };
}

function hasActionableDispatch(dispatch) {
  return dispatch?.state === 'proposed' || ACTIVE_DISPATCH_STATES.has(dispatch?.state);
}

function buildBriefingText({ metrics, priorities, proposedDispatches, activeDispatches, gaps, resources, persons, alerts, sitrep, resourceById, incidentById }) {
  const lines = [
    `SITREP — Command Post, La Guaira`,
    `Generated ${formatTime(sitrep?.generated_at ?? new Date().toISOString())}`,
    '',
    'SUMMARY',
    `- Open incidents: ${metrics.open}`,
    `- Critical/high incidents: ${metrics.severe}`,
    `- Known affected people: ${metrics.affected}`,
    `- Dispatches awaiting confirmation: ${metrics.awaiting}`,
    `- Available resources: ${metrics.availableResources}/${metrics.totalResources}`,
    '',
    'TOP PRIORITIES',
  ];

  if (priorities.length === 0) {
    lines.push('- No active priorities.');
  } else {
    priorities.forEach((incident, idx) => {
      const dispatchTone = getDispatchTone(incident.dispatch);
      lines.push(
        `${idx + 1}. [${incident.urgency?.toUpperCase() ?? 'UNKNOWN'}] ${incident.category ?? 'incident'} @ ${incident.location ?? 'unknown location'} — ${incident.summary ?? 'No summary'} (${dispatchTone.label})`,
      );
    });
  }

  lines.push('', 'DISPATCH READINESS');
  if (proposedDispatches.length === 0 && activeDispatches.length === 0) {
    lines.push('- No proposed or active dispatches.');
  }
  proposedDispatches.forEach((dispatch) => {
    const incident = incidentById[dispatch.incident_id];
    const resource = resourceById[dispatch.resource_id];
    lines.push(`- PROPOSED: ${resource?.label ?? dispatch.resource_id} -> ${incident?.location ?? dispatch.incident_id}`);
  });
  activeDispatches.forEach((dispatch) => {
    const incident = incidentById[dispatch.incident_id];
    const resource = resourceById[dispatch.resource_id];
    lines.push(`- ${dispatch.state.toUpperCase()}: ${resource?.label ?? dispatch.resource_id} -> ${incident?.location ?? dispatch.incident_id}`);
  });

  lines.push('', 'GAPS');
  if (gaps.length === 0) {
    lines.push('- No unmatched open incidents.');
  } else {
    gaps.forEach((incident) => {
      lines.push(`- [${incident.urgency?.toUpperCase() ?? 'UNKNOWN'}] ${incident.location ?? 'unknown location'} needs ${incident.category ?? 'support'}`);
    });
  }

  lines.push('', 'RESOURCE POSTURE');
  resources.slice(0, 8).forEach((resource) => {
    lines.push(`- ${resource.label}: ${resource.status}${resource.location ? ` @ ${resource.location}` : ''}${resource.capacity ? ` (${resource.capacity})` : ''}`);
  });

  lines.push('', 'PERSONS / ALERTS');
  lines.push(`- Missing persons: ${persons.filter((p) => p.status === 'missing').length}`);
  lines.push(`- Active alerts: ${alerts.length}`);

  if (sitrep?.text) {
    lines.push('', 'GENERATED NARRATIVE', sitrep.text);
  }

  return lines.join('\n');
}

function SitrepModal({
  open,
  loading,
  sitrep,
  error,
  incidents = [],
  resources = [],
  dispatches = [],
  persons = [],
  alerts = [],
  escalated = {},
  onClose,
  onRegenerate,
}) {
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

  const board = useMemo(() => {
    const resourceById = indexById(resources);
    const incidentById = indexById(incidents);
    const latestDispatchByIncident = {};
    for (const dispatch of dispatches) latestDispatchByIncident[dispatch.incident_id] = dispatch;

    const openIncidents = incidents.filter((incident) => incident.status === 'open');
    const priorityIncidents = sortIncidents(openIncidents).map((incident) => ({
      ...incident,
      dispatch: latestDispatchByIncident[incident.id],
      escalated: Boolean(escalated[incident.id]),
    }));
    const proposedDispatches = dispatches.filter((dispatch) => dispatch.state === 'proposed');
    const activeDispatches = dispatches.filter((dispatch) => ACTIVE_DISPATCH_STATES.has(dispatch.state));
    const gaps = priorityIncidents.filter((incident) => !hasActionableDispatch(incident.dispatch));
    const affected = openIncidents.reduce((sum, incident) => sum + (Number(incident.people_count) || 0), 0);
    const severe = openIncidents.filter((incident) => incident.urgency === 'critical' || incident.urgency === 'high').length;
    const availableResources = resources.filter((resource) => resource.status === 'available');
    const missingPersons = persons.filter((person) => person.status === 'missing');
    const activeAlerts = alerts.filter((alert) => alert.active !== false);

    return {
      resourceById,
      incidentById,
      priorities: priorityIncidents,
      proposedDispatches,
      activeDispatches,
      gaps,
      activeAlerts,
      missingPersons,
      metrics: {
        open: openIncidents.length,
        severe,
        affected: affected || 'unknown',
        awaiting: proposedDispatches.length,
        availableResources: availableResources.length,
        totalResources: resources.length,
        missing: missingPersons.length,
      },
    };
  }, [alerts, dispatches, escalated, incidents, persons, resources]);

  const briefingText = useMemo(
    () =>
      buildBriefingText({
        metrics: board.metrics,
        priorities: board.priorities,
        proposedDispatches: board.proposedDispatches,
        activeDispatches: board.activeDispatches,
        gaps: board.gaps,
        resources,
        persons,
        alerts: board.activeAlerts,
        sitrep,
        resourceById: board.resourceById,
        incidentById: board.incidentById,
      }),
    [board, resources, persons, sitrep],
  );

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(briefingText);
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
          <div className="cmd-sitrep-title">
            <span className="bru-panel__title">
              <Icon name="sitrep" />
              SITREP — Situation Report
            </span>
            <span className="bru-meta">
              {sitrep?.generated_at ? `Generated ${formatTime(sitrep.generated_at)}` : 'Live board briefing'}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Icon name="close" />
            Close
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
            <div className="cmd-sitrep">
              <section className="cmd-sitrep-hero">
                <div>
                  <div className="cmd-sitrep-kicker">Operational handoff</div>
                  <h2>Current board is ready for shift briefing.</h2>
                  <p>
                    {board.metrics.open === 0
                      ? 'No open incidents are on the board. Keep monitoring field intake and alerts.'
                      : `${board.metrics.open} open incident${board.metrics.open === 1 ? '' : 's'} require command attention, with ${board.metrics.awaiting} AI dispatch proposal${board.metrics.awaiting === 1 ? '' : 's'} awaiting a human decision.`}
                  </p>
                </div>
                <div className="cmd-sitrep-score">
                  <span>{board.metrics.severe}</span>
                  <small>critical / high</small>
                </div>
              </section>

              <section className="cmd-sitrep-metrics" aria-label="Situation report metrics">
                <div className="cmd-sitrep-metric">
                  <span>Open incidents</span>
                  <strong>{board.metrics.open}</strong>
                </div>
                <div className="cmd-sitrep-metric">
                  <span>Known affected</span>
                  <strong>{board.metrics.affected}</strong>
                </div>
                <div className="cmd-sitrep-metric">
                  <span>Awaiting decisions</span>
                  <strong>{board.metrics.awaiting}</strong>
                </div>
                <div className="cmd-sitrep-metric">
                  <span>Resources available</span>
                  <strong>{board.metrics.availableResources}/{board.metrics.totalResources}</strong>
                </div>
                <div className="cmd-sitrep-metric">
                  <span>Missing persons</span>
                  <strong>{board.metrics.missing}</strong>
                </div>
              </section>

              <section className="cmd-sitrep-grid">
                <div className="cmd-sitrep-section cmd-sitrep-section--wide">
                  <div className="cmd-sitrep-section__head">
                    <h3>Immediate Priorities</h3>
                    <Badge variant="muted">{board.priorities.length} open</Badge>
                  </div>
                  {board.priorities.length === 0 ? (
                    <div className="bru-empty">
                      <span>No open incidents to prioritize.</span>
                    </div>
                  ) : (
                    <ol className="cmd-sitrep-priorities">
                      {board.priorities.slice(0, 6).map((incident) => {
                        const dispatchTone = getDispatchTone(incident.dispatch);
                        return (
                          <li key={incident.id} className="cmd-sitrep-priority" data-escalated={incident.escalated}>
                            <div className="cmd-sitrep-priority__rank" aria-hidden="true" />
                            <div className="cmd-sitrep-priority__body">
                              <div className="cmd-sitrep-priority__badges">
                                <Badge urgency={incident.urgency} pulse={incident.urgency === 'critical'} />
                                <Badge variant={dispatchTone.variant}>{dispatchTone.label}</Badge>
                                {incident.escalated && <Badge variant="critical" dot>escalated</Badge>}
                              </div>
                              <strong>{incident.location ?? 'Unknown location'}</strong>
                              <p>{incident.summary ?? 'No summary available.'}</p>
                              <span className="bru-meta">
                                {incident.category ?? 'incident'} · {incident.people_count ?? '?'} affected · {formatAge(incident.created_at)}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>

                <div className="cmd-sitrep-section">
                  <div className="cmd-sitrep-section__head">
                    <h3>Dispatch Readiness</h3>
                    <Badge variant={board.proposedDispatches.length ? 'accent' : 'muted'}>
                      {board.proposedDispatches.length} proposed
                    </Badge>
                  </div>
                  <div className="cmd-sitrep-stack">
                    {board.proposedDispatches.length === 0 && board.activeDispatches.length === 0 ? (
                      <div className="bru-empty">
                        <span>No dispatches are pending or active.</span>
                      </div>
                    ) : (
                      [...board.proposedDispatches, ...board.activeDispatches].slice(0, 6).map((dispatch) => {
                        const incident = board.incidentById[dispatch.incident_id];
                        const resource = board.resourceById[dispatch.resource_id];
                        const tone = getDispatchTone(dispatch);
                        return (
                          <article key={dispatch.id} className="cmd-sitrep-mini-card">
                            <div>
                              <strong>{resource?.label ?? dispatch.resource_id}</strong>
                              <span>{incident?.location ?? dispatch.incident_id}</span>
                            </div>
                            <Badge variant={tone.variant}>{tone.label}</Badge>
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="cmd-sitrep-section">
                  <div className="cmd-sitrep-section__head">
                    <h3>Open Gaps</h3>
                    <Badge variant={board.gaps.length ? 'critical' : 'ok'}>{board.gaps.length} unmatched</Badge>
                  </div>
                  <div className="cmd-sitrep-stack">
                    {board.gaps.length === 0 ? (
                      <div className="bru-empty">
                        <span>Every open incident has at least one dispatch record.</span>
                      </div>
                    ) : (
                      board.gaps.slice(0, 5).map((incident) => (
                        <article key={incident.id} className="cmd-sitrep-mini-card">
                          <div>
                            <strong>{incident.category ?? 'support'} needed</strong>
                            <span>{incident.location ?? 'Unknown location'}</span>
                          </div>
                          <Badge urgency={incident.urgency} />
                        </article>
                      ))
                    )}
                  </div>
                </div>

                <div className="cmd-sitrep-section">
                  <div className="cmd-sitrep-section__head">
                    <h3>Resource Posture</h3>
                    <Badge variant="muted">{resources.length} total</Badge>
                  </div>
                  <div className="cmd-sitrep-stack">
                    {resources.length === 0 ? (
                      <div className="bru-empty">
                        <span>No resources in inventory.</span>
                      </div>
                    ) : (
                      resources.slice(0, 6).map((resource) => (
                        <article key={resource.id} className="cmd-sitrep-mini-card">
                          <div>
                            <strong>{resource.label}</strong>
                            <span>
                              {resource.location ?? 'location unknown'} · {resource.capacity ?? resource.type}
                            </span>
                          </div>
                          <Badge variant={resource.status === 'available' ? 'ok' : 'muted'} dot>
                            {resource.status}
                          </Badge>
                        </article>
                      ))
                    )}
                  </div>
                </div>

                <div className="cmd-sitrep-section">
                  <div className="cmd-sitrep-section__head">
                    <h3>Alerts & Persons</h3>
                    <Badge variant={board.activeAlerts.length ? 'warn' : 'muted'}>{board.activeAlerts.length} alerts</Badge>
                  </div>
                  <div className="cmd-sitrep-stack">
                    {board.activeAlerts.slice(0, 3).map((alert) => (
                      <article key={alert.id} className="cmd-sitrep-mini-card">
                        <div>
                          <strong>{alert.message}</strong>
                          <span>{alert.zone || 'all zones'} · {formatTime(alert.created_at)}</span>
                        </div>
                        <Badge variant={alert.severity === 'critical' ? 'critical' : 'warn'}>{alert.severity}</Badge>
                      </article>
                    ))}
                    {board.missingPersons.slice(0, 3).map((person) => (
                      <article key={person.id} className="cmd-sitrep-mini-card">
                        <div>
                          <strong>{person.name}</strong>
                          <span>{person.detail || 'No detail'} </span>
                        </div>
                        <Badge variant="critical">missing</Badge>
                      </article>
                    ))}
                    {board.activeAlerts.length === 0 && board.missingPersons.length === 0 && (
                      <div className="bru-empty">
                        <span>No active alerts or missing-person flags.</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="cmd-sitrep-section cmd-sitrep-section--wide">
                  <div className="cmd-sitrep-section__head">
                    <h3>Generated Narrative</h3>
                    <Badge variant="muted">model summary</Badge>
                  </div>
                  <pre className="cmd-sitrep-text">{sitrep?.text || 'No generated narrative returned.'}</pre>
                </div>
              </section>
            </div>
          )}
        </div>

        <footer className="cmd-modal__foot">
          <span className="bru-meta">Copy exports the full structured briefing.</span>
          <div className="cmd-modal__foot-actions">
            <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={loading}>
              <Icon name="refresh" />
              Regenerate
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={copy}
              disabled={loading || Boolean(error)}
            >
              <Icon name={copied ? 'check' : 'copy'} />
              {copied ? 'Copied' : 'Copy briefing'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default SitrepModal;
