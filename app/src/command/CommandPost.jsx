import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../shared/styles.css';
import './command.css';
import Panel from '../shared/Panel.jsx';
import Badge from '../shared/Badge.jsx';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import BrujulaMark from '../shared/BrujulaMark.jsx';
import { sortByPriority } from '../shared/urgency.js';
import IncidentCard from './IncidentCard.jsx';
import DispatchProposal from './DispatchProposal.jsx';
import IncidentDrawer from './IncidentDrawer.jsx';
import SitrepModal from './SitrepModal.jsx';
import MapPanel from './MapPanel.jsx';
import ConnectModal from './ConnectModal.jsx';
import OfflineMapsModal from './OfflineMapsModal.jsx';
import CommandSettings from './CommandSettings.jsx';
import { loadCommandDensity, saveCommandDensity } from './commandSettingsStorage.js';
import {
  USE_MOCKS,
  getSync,
  getSitrep,
  confirmDispatch,
  createAlert,
  deactivateAlert,
  getPersons,
  getTrends,
} from './dataSource.js';
import AlertComposer from './AlertComposer.jsx';
import AlertStrip from './AlertStrip.jsx';
import PersonsPanel from './PersonsPanel.jsx';
import TrendsPanel from './TrendsPanel.jsx';
import { useWatchdog } from './useWatchdog.js';

const POLL_MS = 4000; // CONTRACTS §5: poll /api/sync every 3–5 s

// /api/sync returns DELTAS (records changed since `since`), so accumulate by
// id — same pattern as the field client's useAssignments. Replacing state with
// each poll wiped the board on the first quiet tick.
function mergeById(prev, incoming) {
  if (!incoming || incoming.length === 0) return prev;
  const map = new Map(prev.map((x) => [x.id, x]));
  for (const x of incoming) map.set(x.id, x);
  return [...map.values()];
}

function CommandPost() {
  const [incidents, setIncidents] = useState([]);
  const [resources, setResources] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [persons, setPersons] = useState([]);

  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState(null);
  const [dispatchBusy, setDispatchBusy] = useState(false);

  const [sitrepOpen, setSitrepOpen] = useState(false);
  const [sitrep, setSitrep] = useState(null);
  const [sitrepLoading, setSitrepLoading] = useState(false);
  const [sitrepError, setSitrepError] = useState(null);

  const [connectOpen, setConnectOpen] = useState(false);
  const [offlineMapsOpen, setOfflineMapsOpen] = useState(false);
  const [alertComposerOpen, setAlertComposerOpen] = useState(false);
  const [density, setDensity] = useState(loadCommandDensity);

  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const data = await getSync(seqRef.current);
      if (Array.isArray(data.incidents)) setIncidents((p) => mergeById(p, data.incidents));
      if (Array.isArray(data.resources)) setResources((p) => mergeById(p, data.resources));
      if (Array.isArray(data.dispatches)) setDispatches((p) => mergeById(p, data.dispatches));
      if (Array.isArray(data.alerts)) setAlerts((p) => mergeById(p, data.alerts));
      if (Array.isArray(data.persons)) setPersons((p) => mergeById(p, data.persons));
      if (typeof data.seq === 'number') {
        seqRef.current = data.seq;
      }
    } catch (e) {
      console.error('sync failed:', e.message || e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Escalation watchdog: tracks unattended incidents
  const escalated = useWatchdog(incidents, dispatches);

  const ordered = useMemo(() => sortByPriority(incidents), [incidents]);

  const dispatchByIncident = useMemo(() => {
    const map = {};
    for (const d of dispatches) {
      // Prefer the incident's explicitly proposed dispatch, else latest.
      map[d.incident_id] = d;
    }
    return map;
  }, [dispatches]);

  const proposals = useMemo(
    () => dispatches.filter((d) => d.state === 'proposed'),
    [dispatches],
  );

  const availableResources = useMemo(
    () => resources.filter((r) => r.status === 'available'),
    [resources],
  );

  const resourceById = useMemo(() => {
    const m = {};
    for (const r of resources) m[r.id] = r;
    return m;
  }, [resources]);

  const incidentById = useMemo(() => {
    const m = {};
    for (const i of incidents) m[i.id] = i;
    return m;
  }, [incidents]);

  const selected = selectedId ? incidentById[selectedId] : null;
  const selectedDispatch = selected ? dispatchByIncident[selected.id] : null;

  const handleConfirm = useCallback(
    async (dispatch, action = 'confirm', resourceId) => {
      setDispatchBusy(true);
      try {
        await confirmDispatch(dispatch.incident_id, {
          dispatch_id: dispatch.id,
          action,
          ...(action === 'override' ? { resource_id: resourceId } : {}),
        });
        await refresh();
      } catch (e) {
        console.error('dispatch failed:', e.message || e);
      } finally {
        setDispatchBusy(false);
      }
    },
    [refresh],
  );

  const handleOverride = useCallback(
    (dispatch, resourceId) => handleConfirm(dispatch, 'override', resourceId),
    [handleConfirm],
  );

  const openSitrep = useCallback(async () => {
    setSitrepOpen(true);
    setSitrepLoading(true);
    setSitrepError(null);
    try {
      const s = await getSitrep();
      setSitrep(s);
    } catch (e) {
      setSitrepError(e.message || 'Failed to generate sitrep');
    } finally {
      setSitrepLoading(false);
    }
  }, []);

  const criticalCount = ordered.filter((i) => i.urgency === 'critical' && i.status === 'open').length;

  const changeDensity = (next) => {
    setDensity(next);
    saveCommandDensity(next);
  };

  return (
    <div className={`bru-app cmd-root${density === 'compact' ? ' cmd-root--compact' : ''}`}>
      <header className="cmd-topbar">
        <div className="cmd-topbar__status">
          <Badge variant="warn" dot title="No internet — everything runs locally">
            OFFLINE
          </Badge>
          <Badge variant="ok" dot title="Gemma running on this laptop">
            GEMMA · LOCAL
          </Badge>
        </div>

        <div className="cmd-topbar__brand">
          <BrujulaMark size={60} spinning title="Brújula — Command Post" />
          <div className="cmd-topbar__wordmark">
            <div className="cmd-topbar__title">BRÚJULA</div>
            <div className="cmd-topbar__sub">Command Post · La Guaira</div>
          </div>
        </div>

        <div className="cmd-topbar__actions">
          {USE_MOCKS && (
            <Badge variant="muted" title="Using local mock data — INTEGRATION flips USE_MOCKS in dataSource.js">
              MOCK DATA
            </Badge>
          )}
          <Button variant="default" onClick={() => setAlertComposerOpen(true)} title="Broadcast an alert to field" aria-label="Broadcast alert">
            <Icon name="alert" />
            Alert
          </Button>
          <Button variant="primary" onClick={openSitrep}>
            <Icon name="sitrep" />
            SITREP
          </Button>
        </div>
          <CommandSettings
            density={density}
            onDensityChange={changeDensity}
            onConnectPhone={() => setConnectOpen(true)}
            onOfflineMaps={() => setOfflineMapsOpen(true)}
            onRefresh={refresh}
            refreshing={loading}
          />
      </header>

      {/* --- Active alerts strip --- */}
      {alerts.length > 0 && (
        <AlertStrip alerts={alerts} onDeactivate={deactivateAlert} />
      )}

      <main className="cmd-main">
        {/* --- Left column: offline map + prioritized action feed --- */}
        <div className="cmd-left">
        <MapPanel incidents={ordered} onSelect={setSelectedId} />

        {/* --- Prioritized action feed --- */}
        <Panel
          title="Prioritized Action Feed"
          icon={<Icon name="feed" />}
          className="cmd-feed"
          actions={
            <div className="cmd-feed__counts">
              {criticalCount > 0 && (
                <Badge variant="critical" dot pulse>
                  {criticalCount} CRITICAL
                </Badge>
              )}
              <Badge variant="muted">{ordered.length} incidents</Badge>
            </div>
          }
        >
          {loading ? (
            <div className="cmd-feed__loading">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bru-skeleton cmd-skel-card" />
              ))}
            </div>
          ) : ordered.length === 0 ? (
            <div className="bru-empty">
              <strong>Board clear</strong>
              <span>No open incidents. Waiting for field reports…</span>
            </div>
          ) : (
            <div className="cmd-feed__list">
              {ordered.map((inc) => (
                <IncidentCard
                  key={inc.id}
                  incident={inc}
                  selected={inc.id === selectedId}
                  hasProposal={dispatchByIncident[inc.id]?.state === 'proposed'}
                  escalated={escalated[inc.id]}
                  onSelect={(i) => setSelectedId(i.id)}
                />
              ))}
            </div>
          )}
        </Panel>
        </div>

        {/* --- Right rail: AI proposals + resources --- */}
        <div className="cmd-rail">
          <Panel
            title="AI Dispatch Proposals"
            icon={<Icon name="dispatch" />}
            className="cmd-rail__panel"
            actions={
              proposals.length > 0 ? (
                <Badge variant="accent" dot pulse>
                  {proposals.length} AWAITING
                </Badge>
              ) : (
                <Badge variant="muted">clear</Badge>
              )
            }
          >
            {proposals.length === 0 ? (
              <div className="bru-empty">
                <span>No dispatch proposals awaiting confirmation.</span>
              </div>
            ) : (
              <div className="cmd-rail__list">
                {proposals.map((d) => (
                  <DispatchProposal
                    key={d.id}
                    dispatch={d}
                    incident={incidentById[d.incident_id]}
                    resource={resourceById[d.resource_id]}
                    availableResources={availableResources}
                    onConfirm={(dsp) => handleConfirm(dsp)}
                    onOverride={handleOverride}
                    busy={dispatchBusy}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Resource Inventory"
            icon={<Icon name="resource" />}
            className="cmd-rail__panel cmd-rail__panel--resources"
            actions={
              <Badge variant="muted">
                {availableResources.length}/{resources.length} available
              </Badge>
            }
          >
            {resources.length === 0 ? (
              <div className="bru-empty">
                <span>No resources in inventory.</span>
              </div>
            ) : (
              <ul className="cmd-resources">
                {resources.map((r) => (
                  <li key={r.id} className="cmd-resource" data-committed={r.status === 'committed'}>
                    <div className="cmd-resource__main">
                      <span className="cmd-resource__label">{r.label}</span>
                      <span className="bru-meta">
                        <Icon name="location" /> {r.location} · {r.capacity}
                        {r.quantity != null && <span> · {r.quantity} {r.unit || 'units'}</span>}
                      </span>
                    </div>
                    <Badge variant={r.status === 'available' ? 'ok' : 'muted'} dot>
                      {r.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <TrendsPanel getTrends={getTrends} />

          <PersonsPanel persons={persons} />
        </div>
      </main>

      {selected && (
        <IncidentDrawer
          incident={selected}
          dispatch={selectedDispatch}
          resource={selectedDispatch ? resourceById[selectedDispatch.resource_id] : null}
          availableResources={availableResources}
          dispatchBusy={dispatchBusy}
          onClose={() => setSelectedId(null)}
          onConfirm={(dsp) => handleConfirm(dsp)}
          onOverride={handleOverride}
          onOpenSitrep={openSitrep}
          onPatchIncident={async (id, patch) => {
            await refresh();
          }}
          onRematchIncident={async (id) => {
            await refresh();
          }}
          escalated={escalated[selected.id]}
        />
      )}

      <SitrepModal
        open={sitrepOpen}
        loading={sitrepLoading}
        sitrep={sitrep}
        error={sitrepError}
        incidents={incidents}
        resources={resources}
        dispatches={dispatches}
        alerts={alerts}
        persons={persons}
        escalated={escalated}
        onClose={() => setSitrepOpen(false)}
        onRegenerate={openSitrep}
      />

      <AlertComposer
        open={alertComposerOpen}
        onClose={() => setAlertComposerOpen(false)}
        onSubmit={async (alert) => {
          await createAlert(alert);
          await refresh();
          setAlertComposerOpen(false);
        }}
      />

      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />

      <OfflineMapsModal open={offlineMapsOpen} onClose={() => setOfflineMapsOpen(false)} />
    </div>
  );
}

export default CommandPost;
