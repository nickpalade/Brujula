import { useEffect, useRef, useState } from 'react';
import Badge from '../shared/Badge.jsx';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import { useBorderGlow } from '../shared/BorderGlow.jsx';
import { CATEGORY_LABEL, formatAge } from '../shared/urgency.js';
import { patchIncident } from './dataSource.js';

const CATEGORIES = ['rescue', 'medical', 'water', 'shelter', 'food', 'machinery', 'hazard', 'status'];
const URGENCIES = ['critical', 'high', 'medium', 'low'];

function titleCase(value) {
  if (!value) return 'Unknown';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatReportCoords(report) {
  if (!Number.isFinite(report?.lat) || !Number.isFinite(report?.lon)) return null;
  const coords = `${report.lat.toFixed(5)}, ${report.lon.toFixed(5)}`;
  return Number.isFinite(report.accuracy) ? `${coords} (±${Math.round(report.accuracy)} m)` : coords;
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
  availableResources = [],
  dispatchBusy,
  rematchBusy,
  escalated,
  onClose,
  onSelect,
  onConfirm,
  onOverride,
  onOpenSitrep,
  onRematchIncident,
  onPatchIncident,
  onDeactivateAlert,
}) {
  const closeButtonRef = useRef(null);
  const glow = useBorderGlow();

  // Incident edit mode (mirrors IncidentDrawer's edit/resolve code path).
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({});
  const [editBusy, setEditBusy] = useState(false);

  // Dispatch override picker (mirrors DispatchProposal's override flow).
  const [overriding, setOverriding] = useState(false);
  const [overridePick, setOverridePick] = useState('');

  const [alertBusy, setAlertBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const incidentId = incident?.id;

  // Move focus to the close control whenever a new item opens the inspector.
  useEffect(() => {
    if (selectedGraphItem) closeButtonRef.current?.focus();
  }, [selectedGraphItem]);

  // Reset transient action UI when the selection changes.
  useEffect(() => {
    setOverriding(false);
    setOverridePick('');
    setActionError(null);
  }, [selectedGraphItem]);

  // While the edit form or the override picker is open, Escape cancels that
  // state instead of closing the inspector. Capture phase so this runs before
  // CommandGraph's window-level Escape handler; stopPropagation keeps the
  // event from reaching it.
  useEffect(() => {
    if (!editMode && !overriding) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setEditMode(false);
      setOverriding(false);
      setOverridePick('');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [editMode, overriding]);

  // Seed the incident edit form when the linked incident changes.
  useEffect(() => {
    if (incident) {
      setEditData({
        category: incident.category,
        urgency: incident.urgency,
        location: incident.location,
        people_count: incident.people_count,
        summary: incident.summary,
      });
    }
    setEditMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  if (!selectedGraphItem) return null;

  const isIncidentSelection = selectedGraphItem.type === 'incident';
  const typeLabel = titleCase(selectedGraphItem.type);
  const itemTitle = getItemTitle({ selectedGraphItem, incident, dispatch, resource, report, person, alert });
  const selectedIncident = incident ?? (dispatch ? incidentById[dispatch.incident_id] : null) ?? (person ? incidentById[person.incident_id] : null);
  const reportCoords = formatReportCoords(report);

  const handleEditSave = async () => {
    if (!incidentId) return;
    setEditBusy(true);
    setActionError(null);
    try {
      await patchIncident(incidentId, editData);
      if (onPatchIncident) await onPatchIncident(incidentId, editData);
      setEditMode(false);
    } catch (error) {
      setActionError(error.message || 'Incident update failed');
    } finally {
      setEditBusy(false);
    }
  };

  const handleResolve = async () => {
    if (!incidentId) return;
    setEditBusy(true);
    setActionError(null);
    try {
      await patchIncident(incidentId, { status: 'resolved' });
      if (onPatchIncident) await onPatchIncident(incidentId, { status: 'resolved' });
    } catch (error) {
      setActionError(error.message || 'Incident resolve failed');
    } finally {
      setEditBusy(false);
    }
  };

  const handleDeactivateAlert = async () => {
    if (!alert || !onDeactivateAlert) return;
    setAlertBusy(true);
    try {
      await onDeactivateAlert(alert);
    } finally {
      setAlertBusy(false);
    }
  };

  return (
    <>
      <div className="cmd-drawer-scrim" onClick={onClose} />
      <aside
        className="cmd-drawer cmd-graph-inspector border-glow-host"
        role="dialog"
        aria-label="Graph relationship inspector"
        data-testid="graph-inspector"
        onPointerMove={glow.onPointerMove}
        style={glow.style}
      >
        <span className="edge-light" aria-hidden="true" />
        <header className="cmd-drawer__head" data-urgency={incident?.urgency ?? alert?.severity}>
          <div className="cmd-drawer__head-badges">
            <Badge variant="accent">{typeLabel}</Badge>
            {incident?.urgency && <Badge urgency={incident.urgency} pulse={incident.urgency === 'critical'} />}
            {incident?.corrected_by_human && <Badge variant="accent" dot>corrected</Badge>}
            {dispatch?.state && <Badge variant={dispatch.state === 'proposed' ? 'accent' : 'ok'}>{titleCase(dispatch.state)}</Badge>}
            {resource?.status && <Badge variant={resource.status === 'available' ? 'ok' : 'muted'}>{resource.status}</Badge>}
            {person?.status && <Badge variant={person.status === 'missing' ? 'critical' : 'ok'}>{person.status}</Badge>}
            {alert?.severity && <Badge variant={alert.severity === 'critical' ? 'critical' : 'warn'}>{alert.severity}</Badge>}
            {report?.parsed_kind && <Badge variant="muted">{titleCase(report.parsed_kind)}</Badge>}
            {report?.parsed_category && (
              <Badge variant="muted">{CATEGORY_LABEL[report.parsed_category] ?? titleCase(report.parsed_category)}</Badge>
            )}
            {escalated?.escalated && <Badge variant="critical" pulse dot>{escalated.label}</Badge>}
          </div>
          <div className="cmd-drawer__head-actions">
            {isIncidentSelection && incident && (
              <Button variant="ghost" size="sm" onClick={() => setEditMode(!editMode)} title="Edit incident" aria-label="Edit incident">
                <Icon name="edit" />
              </Button>
            )}
            <Button ref={closeButtonRef} variant="ghost" size="sm" onClick={onClose} title="Close graph inspector" aria-label="Close graph inspector">
              <Icon name="close" />
            </Button>
          </div>
        </header>

        <div className="cmd-drawer__body">
          {editMode && incident ? (
            <section className="cmd-graph-inspector-hero cmd-graph-inspector-edit">
              <span className="cmd-graph-node__eyebrow">Edit incident</span>
              <div className="cmd-graph-inspector-edit__field">
                <label htmlFor="graph-edit-summary">Summary</label>
                <textarea
                  id="graph-edit-summary"
                  value={editData.summary || ''}
                  onChange={(event) => setEditData({ ...editData, summary: event.target.value })}
                />
              </div>
              <div className="cmd-graph-inspector-edit__grid">
                <div className="cmd-graph-inspector-edit__field">
                  <label htmlFor="graph-edit-category">Category</label>
                  <select
                    id="graph-edit-category"
                    className="cmd-select"
                    value={editData.category || ''}
                    onChange={(event) => setEditData({ ...editData, category: event.target.value })}
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABEL[category] ?? category}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cmd-graph-inspector-edit__field">
                  <label htmlFor="graph-edit-urgency">Urgency</label>
                  <select
                    id="graph-edit-urgency"
                    className="cmd-select"
                    value={editData.urgency || ''}
                    onChange={(event) => setEditData({ ...editData, urgency: event.target.value })}
                  >
                    {URGENCIES.map((urgency) => (
                      <option key={urgency} value={urgency}>
                        {titleCase(urgency)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="cmd-graph-inspector-edit__field">
                <label htmlFor="graph-edit-location">Location</label>
                <input
                  id="graph-edit-location"
                  type="text"
                  value={editData.location || ''}
                  onChange={(event) => setEditData({ ...editData, location: event.target.value })}
                />
              </div>
              <div className="cmd-graph-inspector-edit__field">
                <label htmlFor="graph-edit-people">People count</label>
                <input
                  id="graph-edit-people"
                  type="number"
                  value={editData.people_count ?? ''}
                  onChange={(event) =>
                    setEditData({ ...editData, people_count: event.target.value ? parseInt(event.target.value, 10) : null })
                  }
                />
              </div>
              <div className="cmd-graph-inspector-edit__actions">
                <Button variant="default" onClick={() => setEditMode(false)} disabled={editBusy}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleEditSave} disabled={editBusy}>
                  {editBusy ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </section>
          ) : (
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
                {reportCoords && <span>GPS {reportCoords}</span>}
                {person?.matched != null && <span>{person.matched ? 'matched' : 'unmatched'}</span>}
                {alert?.active !== undefined && <span>{alert.active ? 'active' : 'inactive'}</span>}
              </div>
            </section>
          )}

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
          {actionError && (
            <p className="cmd-graph-inspector-error" role="alert">
              {actionError}
            </p>
          )}
          {overriding && dispatch?.state === 'proposed' ? (
            <div className="cmd-graph-inspector-override">
              <label className="cmd-proposal__override-label" htmlFor="graph-override-resource">
                Reassign to resource
              </label>
              <select
                id="graph-override-resource"
                className="cmd-select"
                value={overridePick}
                onChange={(event) => setOverridePick(event.target.value)}
              >
                <option value="">Select resource…</option>
                {availableResources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} — {item.location}
                  </option>
                ))}
              </select>
              <div className="cmd-drawer__foot-actions">
                <Button
                  variant="primary"
                  disabled={!overridePick || dispatchBusy}
                  onClick={() => {
                    onOverride?.(dispatch, overridePick);
                    setOverriding(false);
                    setOverridePick('');
                  }}
                >
                  Confirm override
                </Button>
                <Button variant="ghost" onClick={() => setOverriding(false)} disabled={dispatchBusy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="cmd-drawer__foot-actions">
              {dispatch?.state === 'proposed' && (
                <>
                  <Button variant="confirm" onClick={() => onConfirm(dispatch)} disabled={dispatchBusy}>
                    {dispatchBusy ? 'Confirming...' : 'Confirm dispatch'}
                  </Button>
                  <Button variant="ghost" onClick={() => setOverriding(true)} disabled={dispatchBusy}>
                    Override
                  </Button>
                </>
              )}
              {selectedGraphItem.type === 'alert' && alert && alert.active !== false && (
                <Button variant="danger" onClick={handleDeactivateAlert} disabled={alertBusy}>
                  {alertBusy ? 'Deactivating...' : 'Deactivate alert'}
                </Button>
              )}
              {isIncidentSelection && incident && incident.status !== 'resolved' && !editMode && (
                <Button variant="default" onClick={handleResolve} disabled={editBusy}>
                  {editBusy ? 'Saving...' : 'Resolve'}
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
          )}
        </footer>
      </aside>
    </>
  );
}

export default GraphInspector;
