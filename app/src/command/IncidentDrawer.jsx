import { useEffect, useState } from 'react';
import Badge from '../shared/Badge.jsx';
import Button from '../shared/Button.jsx';
import Panel from '../shared/Panel.jsx';
import Icon from '../shared/Icon.jsx';
import { CATEGORY_LABEL, formatAge, isLiveVictim } from '../shared/urgency.js';
import DispatchProposal from './DispatchProposal.jsx';
import AdvisoryPanel from './AdvisoryPanel.jsx';
import { advise, getReports, patchIncident, rematchIncident } from './dataSource.js';

const CATEGORIES = ['rescue', 'medical', 'water', 'shelter', 'food', 'machinery', 'hazard', 'status'];
const URGENCIES = ['critical', 'high', 'medium', 'low'];

/*
 * IncidentDrawer — right-side detail for a selected incident:
 *   - header (urgency, category, location, people, age)
 *   - dispatch proposal (confirm/override)
 *   - merged report texts (dedup evidence: "N reports merged")
 *   - protocol advisory panel (fetched on open)
 *   - SITREP button (parent renders the modal)
 */
function IncidentDrawer({
  incident,
  dispatch,
  resource,
  availableResources,
  onClose,
  onConfirm,
  onOverride,
  onOpenSitrep,
  dispatchBusy,
  onPatchIncident,
  onRematchIncident,
  escalated,
}) {
  const [advisory, setAdvisory] = useState(null);
  const [advLoading, setAdvLoading] = useState(false);
  const [advError, setAdvError] = useState(null);

  const [reports, setReports] = useState([]);
  const [repLoading, setRepLoading] = useState(false);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({});
  const [editBusy, setEditBusy] = useState(false);

  const incidentId = incident?.id;
  const category = incident?.category;
  const mergedIds = incident?.merged_report_ids;

  // Initialize edit data when incident changes
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
  }, [incidentId]);

  // Fetch protocol advisory whenever the selected incident's category changes.
  useEffect(() => {
    if (!incidentId) return undefined;
    let cancelled = false;
    setAdvLoading(true);
    setAdvError(null);
    setAdvisory(null);
    advise({ incident_type: category, context: incident?.summary })
      .then((a) => !cancelled && setAdvisory(a))
      .catch((e) => !cancelled && setAdvError(e.message || 'Failed to load advisory'))
      .finally(() => !cancelled && setAdvLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, category]);

  const handleEditSave = async () => {
    if (!incidentId) return;
    setEditBusy(true);
    try {
      await patchIncident(incidentId, editData);
      if (onPatchIncident) await onPatchIncident(incidentId, editData);
      setEditMode(false);
    } finally {
      setEditBusy(false);
    }
  };

  const handleResolve = async () => {
    if (!incidentId) return;
    setEditBusy(true);
    try {
      await patchIncident(incidentId, { status: 'resolved' });
      if (onPatchIncident) await onPatchIncident(incidentId, { status: 'resolved' });
    } finally {
      setEditBusy(false);
    }
  };

  const handleRematch = async () => {
    if (!incidentId) return;
    setEditBusy(true);
    try {
      await rematchIncident(incidentId);
      if (onRematchIncident) await onRematchIncident(incidentId);
    } finally {
      setEditBusy(false);
    }
  };

  // Fetch merged report texts for the dedup-evidence section (best-effort).
  useEffect(() => {
    if (!incidentId || !mergedIds?.length) {
      setReports([]);
      return undefined;
    }
    let cancelled = false;
    setRepLoading(true);
    getReports(mergedIds)
      .then((r) => !cancelled && setReports(r))
      .catch(() => !cancelled && setReports([]))
      .finally(() => !cancelled && setRepLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, mergedIds?.length]);

  if (!incident) return null;

  const live = isLiveVictim(incident);
  const mergedCount = mergedIds?.length ?? 0;

  return (
    <>
      <div className="cmd-drawer-scrim" onClick={onClose} />
      <aside className="cmd-drawer" role="dialog" aria-label="Incident detail">
        <header className="cmd-drawer__head" data-urgency={incident.urgency}>
          <div className="cmd-drawer__head-badges">
            <Badge urgency={incident.urgency} pulse={live} />
            <Badge variant="muted">
              {CATEGORY_LABEL[incident.category] ?? incident.category}
            </Badge>
            <Badge variant="muted">{incident.status?.toUpperCase()}</Badge>
            {incident.corrected_by_human && (
              <Badge variant="accent" dot>
                corregido
              </Badge>
            )}
            {escalated?.escalated && (
              <Badge variant="critical" pulse dot>
                {escalated.label}
              </Badge>
            )}
          </div>
          <div className="cmd-drawer__head-actions">
            <Button variant="ghost" size="sm" onClick={() => setEditMode(!editMode)} title="Edit incident" aria-label="Edit incident">
              <Icon name="edit" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} title="Close incident detail" aria-label="Close incident detail">
              <Icon name="close" />
            </Button>
          </div>
        </header>

        <div className="cmd-drawer__body">
          {editMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--bru-s-4)' }}>
              {/* Edit form */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--bru-text-dim)' }}>
                  Summary
                </label>
                <textarea
                  value={editData.summary || ''}
                  onChange={(e) => setEditData({ ...editData, summary: e.target.value })}
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    background: 'var(--bru-bg-0)',
                    color: 'var(--bru-text)',
                    border: '1px solid var(--bru-border-strong)',
                    borderRadius: 'var(--bru-r-sm)',
                    padding: 'var(--bru-s-3)',
                    fontFamily: 'var(--bru-sans)',
                    fontSize: '13px',
                    marginTop: '6px',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--bru-s-3)' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--bru-text-dim)' }}>
                    Category
                  </label>
                  <select
                    value={editData.category || ''}
                    onChange={(e) => setEditData({ ...editData, category: e.target.value })}
                    className="cmd-select"
                    style={{ marginTop: '6px' }}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c] || c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--bru-text-dim)' }}>
                    Urgency
                  </label>
                  <select
                    value={editData.urgency || ''}
                    onChange={(e) => setEditData({ ...editData, urgency: e.target.value })}
                    className="cmd-select"
                    style={{ marginTop: '6px' }}
                  >
                    {URGENCIES.map((u) => (
                      <option key={u} value={u}>
                        {u.charAt(0).toUpperCase() + u.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--bru-text-dim)' }}>
                  Location
                </label>
                <input
                  type="text"
                  value={editData.location || ''}
                  onChange={(e) => setEditData({ ...editData, location: e.target.value })}
                  style={{
                    width: '100%',
                    background: 'var(--bru-bg-0)',
                    color: 'var(--bru-text)',
                    border: '1px solid var(--bru-border-strong)',
                    borderRadius: 'var(--bru-r-sm)',
                    padding: '9px 10px',
                    fontFamily: 'var(--bru-sans)',
                    fontSize: '13px',
                    marginTop: '6px',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--bru-text-dim)' }}>
                  People Count
                </label>
                <input
                  type="number"
                  value={editData.people_count || ''}
                  onChange={(e) => setEditData({ ...editData, people_count: e.target.value ? parseInt(e.target.value) : null })}
                  style={{
                    width: '100%',
                    background: 'var(--bru-bg-0)',
                    color: 'var(--bru-text)',
                    border: '1px solid var(--bru-border-strong)',
                    borderRadius: 'var(--bru-r-sm)',
                    padding: '9px 10px',
                    fontFamily: 'var(--bru-sans)',
                    fontSize: '13px',
                    marginTop: '6px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 'var(--bru-s-2)', marginTop: 'var(--bru-s-2)' }}>
                <Button variant="default" onClick={() => setEditMode(false)} disabled={editBusy}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleEditSave} disabled={editBusy}>
                  {editBusy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="cmd-drawer__summary">{incident.summary}</h2>
              <div className="cmd-drawer__meta">
                <span className="bru-meta">
                  <Icon name="location" /> {incident.location ?? 'Location unknown'}
                </span>
                {incident.people_count != null && (
                  <span className="bru-meta">
                    <Icon name="people" /> {incident.people_count} people
                  </span>
                )}
                <span className="bru-meta">
                  <Icon name="clock" /> {formatAge(incident.created_at)} old
                </span>
              </div>
            </>
          )}

          {!editMode && (
            <>
              {/* --- Dispatch proposal (money shot) --- */}
              {dispatch && (
                <DispatchProposal
                  dispatch={dispatch}
                  incident={incident}
                  resource={resource}
                  availableResources={availableResources}
                  onConfirm={onConfirm}
                  onOverride={onOverride}
                  busy={dispatchBusy}
                />
              )}

              {/* --- Outcome --- */}
              {incident.outcome && (
                <div
                  style={{
                    padding: 'var(--bru-s-3)',
                    background: 'var(--bru-bg-0)',
                    borderLeft: '3px solid var(--bru-accent)',
                    borderRadius: 'var(--bru-r-sm)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--bru-accent)',
                      marginBottom: '4px',
                    }}
                  >
                    MISSION OUTCOME
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--bru-text)', margin: 0 }}>
                    {incident.outcome}
                  </p>
                </div>
              )}

              {/* --- Escalation actions --- */}
              {escalated?.escalated && !dispatch && (
                <div style={{ display: 'flex', gap: 'var(--bru-s-2)' }}>
                  <Button
                    variant="default"
                    onClick={handleRematch}
                    disabled={editBusy}
                    title="Re-run AI matching for this incident"
                  >
                    Re-evaluar
                  </Button>
                </div>
              )}
            </>
          )}

          {/* --- Merged reports = dedup evidence --- */}
          <Panel
            title="Field Reports"
            icon={<Icon name="feed" />}
            className="cmd-reports"
            actions={
              mergedCount > 1 ? (
                <Badge variant="accent" dot>
                  {mergedCount} REPORTS MERGED
                </Badge>
              ) : mergedCount === 1 ? (
                <Badge variant="muted">1 report</Badge>
              ) : null
            }
          >
            {mergedCount === 0 ? (
              <div className="bru-empty">
                <span>No source reports linked (pre-seeded incident).</span>
              </div>
            ) : repLoading ? (
              <div className="cmd-sitrep-loading">
                <span className="cmd-spinner" aria-hidden="true" />
                Loading merged reports…
              </div>
            ) : reports.length > 0 ? (
              <ul className="cmd-reports__list">
                {reports.map((r) => (
                  <li key={r.id} className="cmd-reports__item">
                    <div className="cmd-reports__item-head bru-meta">
                      <span>{r.source_device ?? 'unknown device'}</span>
                      <span>· {formatAge(r.created_at)}</span>
                      {r.lang && <span>· {r.lang}</span>}
                    </div>
                    <p className="cmd-reports__text">"{r.raw_text}"</p>
                  </li>
                ))}
              </ul>
            ) : (
              // Texts unavailable (no reports endpoint) — show dedup count.
              <div className="bru-empty">
                <strong>{mergedCount} reports merged into this incident</strong>
                <span>Report texts not exposed by the hub yet.</span>
              </div>
            )}
          </Panel>

          {/* --- Protocol advisory --- */}
          <AdvisoryPanel advisory={advisory} loading={advLoading} error={advError} />
        </div>

        <footer className="cmd-drawer__foot">
          <div className="cmd-drawer__foot-actions">
            {!editMode && incident.status !== 'resolved' && (
              <Button variant="default" onClick={handleResolve} disabled={editBusy}>
                Resolver
              </Button>
            )}
            <Button variant="primary" onClick={onOpenSitrep} style={{ flex: editMode ? 'auto' : 1 }}>
              ▤ {editMode ? 'SITREP' : 'GENERATE SITREP'}
            </Button>
          </div>
        </footer>
      </aside>
    </>
  );
}

export default IncidentDrawer;
