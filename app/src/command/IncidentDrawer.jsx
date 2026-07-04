import { useEffect, useState } from 'react';
import Badge from '../shared/Badge.jsx';
import Button from '../shared/Button.jsx';
import Panel from '../shared/Panel.jsx';
import { CATEGORY_LABEL, formatAge, isLiveVictim } from '../shared/urgency.js';
import DispatchProposal from './DispatchProposal.jsx';
import AdvisoryPanel from './AdvisoryPanel.jsx';
import { advise, getReports } from './dataSource.js';

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
}) {
  const [advisory, setAdvisory] = useState(null);
  const [advLoading, setAdvLoading] = useState(false);
  const [advError, setAdvError] = useState(null);

  const [reports, setReports] = useState([]);
  const [repLoading, setRepLoading] = useState(false);

  const incidentId = incident?.id;
  const category = incident?.category;
  const mergedIds = incident?.merged_report_ids;

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
            <Badge urgency={incident.urgency} pulse={live} dot />
            <Badge variant="muted">
              {CATEGORY_LABEL[incident.category] ?? incident.category}
            </Badge>
            <Badge variant="muted">{incident.status?.toUpperCase()}</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </header>

        <div className="cmd-drawer__body">
          <h2 className="cmd-drawer__summary">{incident.summary}</h2>
          <div className="cmd-drawer__meta">
            <span className="bru-meta">
              <span aria-hidden="true">◎</span> {incident.location ?? 'Location unknown'}
            </span>
            {incident.people_count != null && (
              <span className="bru-meta">
                <span aria-hidden="true">◍</span> {incident.people_count} people
              </span>
            )}
            <span className="bru-meta">
              <span aria-hidden="true">◷</span> {formatAge(incident.created_at)} old
            </span>
          </div>

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

          {/* --- Merged reports = dedup evidence --- */}
          <Panel
            title="Field Reports"
            icon={<span aria-hidden="true">✉</span>}
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
          <Button variant="primary" block onClick={onOpenSitrep}>
            ▤ GENERATE SITREP
          </Button>
        </footer>
      </aside>
    </>
  );
}

export default IncidentDrawer;
