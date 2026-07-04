import Badge from '../shared/Badge.jsx';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import { CATEGORY_LABEL, formatAge } from '../shared/urgency.js';

function titleCase(value) {
  if (!value) return 'Unknown';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function getItemTitle({ selectedGraphItem, incident, dispatch, resource, report, person, alert }) {
  switch (selectedGraphItem?.type) {
    case 'incident':
      return incident?.location ?? 'Incident';
    case 'report':
      return report?.source_device ?? 'Field report';
    case 'dispatch':
      return resource?.label ?? dispatch?.resource_id ?? 'Dispatch';
    case 'resource':
      return resource?.label ?? 'Resource';
    case 'person':
      return person?.name ?? 'Person';
    case 'alert':
      return alert?.message ?? 'Alert';
    default:
      return 'Graph item';
  }
}

function MiniCard({ title, detail, badge, actionLabel, onAction }) {
  return (
    <article className="cmd-graph-inspector-card">
      <div>
        <strong>{title}</strong>
        {detail && <p>{detail}</p>}
      </div>
      <div className="cmd-graph-inspector-card__actions">
        {badge}
        {onAction && (
          <Button size="sm" variant="ghost" onClick={onAction}>
            {actionLabel ?? 'Open'}
          </Button>
        )}
      </div>
    </article>
  );
}

function EmptyState({ children }) {
  return (
    <div className="bru-empty">
      <span>{children}</span>
    </div>
  );
}

function GraphInspector({
  selectedGraphItem,
  incident,
  dispatch,
  resource,
  report,
  person,
  alert,
  connectedReports = [],
  connectedDispatches = [],
  connectedResources = [],
  connectedPersons = [],
  connectedAlerts = [],
  incidentById = {},
  resourceById = {},
  dispatchBusy,
  rematchBusy,
  escalated,
  onClose,
  onSelect,
  onConfirm,
  onOpenSitrep,
  onRematchIncident,
}) {
  if (!selectedGraphItem) return null;

  const typeLabel = titleCase(selectedGraphItem.type);
  const itemTitle = getItemTitle({ selectedGraphItem, incident, dispatch, resource, report, person, alert });
  const selectedIncident = incident ?? (dispatch ? incidentById[dispatch.incident_id] : null) ?? (person ? incidentById[person.incident_id] : null);

  return (
    <>
      <div className="cmd-drawer-scrim" onClick={onClose} />
      <aside className="cmd-drawer cmd-graph-inspector" role="dialog" aria-label="Graph relationship inspector" data-testid="graph-inspector">
        <header className="cmd-drawer__head" data-urgency={incident?.urgency ?? alert?.severity}>
          <div className="cmd-drawer__head-badges">
            <Badge variant="accent">{typeLabel}</Badge>
            {incident?.urgency && <Badge urgency={incident.urgency} pulse={incident.urgency === 'critical'} />}
            {incident?.corrected_by_human && <Badge variant="accent" dot>corrected</Badge>}
            {dispatch?.state && <Badge variant={dispatch.state === 'proposed' ? 'accent' : 'ok'}>{titleCase(dispatch.state)}</Badge>}
            {resource?.status && <Badge variant={resource.status === 'available' ? 'ok' : 'muted'}>{resource.status}</Badge>}
            {person?.status && <Badge variant={person.status === 'missing' ? 'critical' : 'ok'}>{person.status}</Badge>}
            {alert?.severity && <Badge variant={alert.severity === 'critical' ? 'critical' : 'warn'}>{alert.severity}</Badge>}
            {escalated?.escalated && <Badge variant="critical" pulse dot>{escalated.label}</Badge>}
          </div>
          <div className="cmd-drawer__head-actions">
            <Button variant="ghost" size="sm" onClick={onClose} title="Close graph inspector" aria-label="Close graph inspector">
              <Icon name="close" />
            </Button>
          </div>
        </header>

        <div className="cmd-drawer__body">
          <section className="cmd-graph-inspector-hero">
            <span className="cmd-graph-node__eyebrow">{typeLabel} context</span>
            <h2 className="cmd-drawer__summary">{itemTitle}</h2>
            {incident && (
              <p>{incident.summary ?? 'No incident summary available.'}</p>
            )}
            {report && (
              <p>"{report.raw_text ?? 'No report text available.'}"</p>
            )}
            {dispatch && (
              <p>{dispatch.rationale ?? 'No dispatch rationale recorded.'}</p>
            )}
            {resource && (
              <p>{resource.location ?? 'Location unknown'} · {resource.capacity ?? resource.type ?? 'capacity unknown'}</p>
            )}
            {person && (
              <p>{person.detail ?? 'No person detail recorded.'}</p>
            )}
            {alert && (
              <p>{alert.zone ? `${alert.zone}: ` : ''}{alert.message}</p>
            )}
            <div className="cmd-drawer__meta">
              {incident?.category && <span>{CATEGORY_LABEL[incident.category] ?? incident.category}</span>}
              {incident?.people_count != null && <span>{incident.people_count} people</span>}
              {report?.created_at && <span>{formatAge(report.created_at)} old</span>}
              {person?.matched != null && <span>{person.matched ? 'matched' : 'unmatched'}</span>}
              {alert?.active !== undefined && <span>{alert.active ? 'active' : 'inactive'}</span>}
            </div>
          </section>

          {selectedIncident && selectedGraphItem.type !== 'incident' && (
            <section className="cmd-graph-inspector-section">
              <h3>Linked Incident</h3>
              <MiniCard
                title={selectedIncident.location ?? 'Incident'}
                detail={selectedIncident.summary}
                badge={<Badge urgency={selectedIncident.urgency} />}
                actionLabel="Open incident"
                onAction={() => onSelect({ type: 'incident', incidentId: selectedIncident.id })}
              />
            </section>
          )}

          <section className="cmd-graph-inspector-section">
            <h3>Field Reports</h3>
            {connectedReports.length === 0 ? (
              <EmptyState>No linked report evidence.</EmptyState>
            ) : (
              connectedReports.map((item) => (
                <MiniCard
                  key={item.id}
                  title={item.source_device ?? item.reported_by ?? 'unknown source'}
                  detail={item.raw_text}
                  badge={item.lang ? <Badge variant="muted">{item.lang}</Badge> : null}
                  actionLabel="Open report"
                  onAction={() => onSelect({ type: 'report', reportId: item.id, incidentId: item.parsed_into })}
                />
              ))
            )}
          </section>

          <section className="cmd-graph-inspector-section">
            <h3>Dispatches & Resources</h3>
            {connectedDispatches.length === 0 && connectedResources.length === 0 ? (
              <EmptyState>No linked dispatches or resources.</EmptyState>
            ) : (
              <>
                {connectedDispatches.map((item) => {
                  const itemResource = resourceById[item.resource_id];
                  return (
                    <MiniCard
                      key={item.id}
                      title={itemResource?.label ?? item.resource_id}
                      detail={item.rationale ?? `${titleCase(item.state)} dispatch`}
                      badge={<Badge variant={item.state === 'proposed' ? 'accent' : 'ok'}>{titleCase(item.state)}</Badge>}
                      actionLabel="Open dispatch"
                      onAction={() => onSelect({ type: 'dispatch', dispatchId: item.id, incidentId: item.incident_id })}
                    />
                  );
                })}
                {connectedResources.map((item) => (
                  <MiniCard
                    key={item.id}
                    title={item.label}
                    detail={`${item.location ?? 'Location unknown'} · ${item.capacity ?? item.type}`}
                    badge={<Badge variant={item.status === 'available' ? 'ok' : 'muted'}>{item.status}</Badge>}
                    actionLabel="Open resource"
                    onAction={() => onSelect({ type: 'resource', resourceId: item.id })}
                  />
                ))}
              </>
            )}
          </section>

          <section className="cmd-graph-inspector-section">
            <h3>People</h3>
            {connectedPersons.length === 0 ? (
              <EmptyState>No linked people records.</EmptyState>
            ) : (
              connectedPersons.map((item) => (
                <MiniCard
                  key={item.id}
                  title={item.name}
                  detail={item.detail}
                  badge={<Badge variant={item.status === 'missing' ? 'critical' : 'ok'}>{item.status}</Badge>}
                  actionLabel="Open person"
                  onAction={() => onSelect({ type: 'person', personId: item.id, incidentId: item.incident_id })}
                />
              ))
            )}
          </section>

          <section className="cmd-graph-inspector-section">
            <h3>Alerts</h3>
            {connectedAlerts.length === 0 ? (
              <EmptyState>No related active alerts.</EmptyState>
            ) : (
              connectedAlerts.map((item) => (
                <MiniCard
                  key={item.id}
                  title={item.zone ?? 'All zones'}
                  detail={item.message}
                  badge={<Badge variant={item.severity === 'critical' ? 'critical' : 'warn'}>{item.severity}</Badge>}
                  actionLabel="Open alert"
                  onAction={() => onSelect({ type: 'alert', alertId: item.id })}
                />
              ))
            )}
          </section>
        </div>

        <footer className="cmd-drawer__foot">
          <div className="cmd-drawer__foot-actions">
            {dispatch?.state === 'proposed' && (
              <Button variant="confirm" onClick={() => onConfirm(dispatch)} disabled={dispatchBusy}>
                {dispatchBusy ? 'Confirming...' : 'Confirm dispatch'}
              </Button>
            )}
            {incident && incident.status !== 'resolved' && (
              <Button variant="default" onClick={() => onRematchIncident(incident.id)} disabled={rematchBusy}>
                {rematchBusy ? 'Thinking...' : 'Re-match'}
              </Button>
            )}
            <Button variant="primary" onClick={onOpenSitrep} style={{ flex: 1 }}>
              ▤ GENERATE SITREP
            </Button>
          </div>
        </footer>
      </aside>
    </>
  );
}

export default GraphInspector;
