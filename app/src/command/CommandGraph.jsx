import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../shared/styles.css';
import './command.css';
import './commandGraph.css';
import Badge from '../shared/Badge.jsx';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import { CATEGORY_LABEL, sortByPriority } from '../shared/urgency.js';
import GraphInspector from './GraphInspector.jsx';
import SitrepModal from './SitrepModal.jsx';
import MapPanel from './MapPanel.jsx';
import AlertComposer from './AlertComposer.jsx';
import ContextChat from '../shared/ContextChat.jsx';
import { useWatchdog } from './useWatchdog.js';
import * as dataSource from './dataSource.js';
import {
  USE_MOCKS,
  getSync,
  getSitrep,
  getReports,
  getPersons,
  confirmDispatch,
  createAlert,
  deactivateAlert,
  rematchIncident,
} from './dataSource.js';

const POLL_MS = 4000;

const GRAPH_LAYOUT = {
  report: { x: -520, y: 80, gap: 155 },
  person: { x: -520, gap: 155 },
  intake: { x: -120, y: -120 },
  brain: { x: -120, y: 260 },
  incident: { x: 280, y: 80, gap: 190 },
  dispatch: { x: 700, y: 80, gap: 180 },
  resource: { x: 1100, y: 80, gap: 170 },
  alert: { x: 280, y: -160, gap: 310 },
};

// The People column shares x=-520 with reports, so it starts below the last
// visible report. The break leaves room for tall report nodes (min-height 132,
// content can exceed the 155 gap) plus the "People" section label.
const PERSON_SECTION_BREAK = 140;
const SECTION_LABEL_OFFSET = 56;

const GRAPH_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical only' },
  { id: 'open', label: 'Open only' },
  { id: 'dispatch', label: 'With dispatch' },
  { id: 'people', label: 'People' },
  { id: 'reports', label: 'Reports' },
];

function alertRelatesToIncident(alert, incident) {
  if (!alert || !incident) return false;
  if (!alert.zone) return true;
  const zone = alert.zone.toLowerCase();
  return `${incident.location ?? ''} ${incident.category ?? ''} ${incident.summary ?? ''}`.toLowerCase().includes(zone);
}

function mergeById(prev, incoming) {
  if (!incoming || incoming.length === 0) return prev;
  const map = new Map(prev.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function formatSyncAge(lastSync, now) {
  const seconds = Math.max(0, Math.floor((now - lastSync.getTime()) / 1000));
  return `${seconds}s ago`;
}

function shortText(value, max = 120) {
  if (!value) return 'No summary yet.';
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function GraphShellNode({ children, tone = 'default', testId, ariaLabel, selectTarget, onSelect }) {
  const inspect = () => {
    if (selectTarget) onSelect?.(selectTarget);
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    inspect();
  };

  return (
    <div
      className="cmd-graph-node"
      data-tone={tone}
      data-testid={testId}
      role={selectTarget ? 'button' : undefined}
      tabIndex={selectTarget ? 0 : undefined}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      <Handle type="target" position={Position.Left} className="cmd-graph-handle" />
      <Handle type="source" position={Position.Right} className="cmd-graph-handle" />
      {children}
    </div>
  );
}

function GemmaNode({ data }) {
  return (
    <div className="cmd-graph-node cmd-graph-node--brain">
      <Handle type="target" position={Position.Left} id="in" className="cmd-graph-handle" />
      <Handle type="source" position={Position.Right} id="out" className="cmd-graph-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="cmd-graph-handle" />
      <div className="cmd-graph-brain__orb" aria-hidden="true">
        <img src="/logo-animated.svg" alt="" width="82" height="82" />
      </div>
      <div className="cmd-graph-node__eyebrow">Gemma local brain</div>
      <h2>{'Parse -> match -> advise'}</h2>
      <p>
        {data.openCount} open incidents, {data.proposalCount} proposed dispatches,
        {' '}
        {data.availableCount} matchable resources.
      </p>
      <div className="cmd-graph-node__actions">
        <Button size="sm" variant="primary" onClick={data.onSitrep}>
          <Icon name="sitrep" />
          SITREP
        </Button>
        <Button size="sm" variant="ghost" onClick={data.onChat}>
          Ask Gemma
        </Button>
      </div>
    </div>
  );
}

function IncidentNode({ data }) {
  const incident = data.incident;
  return (
    <GraphShellNode
      tone={incident.urgency}
      testId="graph-node-incident"
      ariaLabel={`Situation ${incident.location ?? incident.id}`}
      selectTarget={data.selectTarget}
      onSelect={data.onSelect}
    >
      <div className="cmd-graph-node__head">
        <Badge urgency={incident.urgency} pulse={incident.urgency === 'critical'} />
        <Badge variant="muted">{CATEGORY_LABEL[incident.category] ?? incident.category}</Badge>
      </div>
      <strong className="cmd-graph-node__title">
        {incident.location ?? 'Location unknown'}
      </strong>
      <p>{shortText(incident.summary)}</p>
      <div className="cmd-graph-node__meta">
        <span>{incident.people_count ?? '?'} people</span>
        <span>{incident.status ?? 'open'}</span>
      </div>
      <div className="cmd-graph-node__actions">
        <Button size="sm" variant="ghost" onClick={() => data.onSelect(data.selectTarget)}>
          Inspect
        </Button>
        {data.needsAction && (
          <Button
            size="sm"
            variant="default"
            onClick={() => data.onRematch(incident.id)}
            disabled={data.rematchBusy}
          >
            {data.rematchBusy ? 'Thinking...' : 'Re-match'}
          </Button>
        )}
      </div>
    </GraphShellNode>
  );
}

function DispatchNode({ data }) {
  const { dispatch, incident, resource } = data;
  return (
    <GraphShellNode
      tone={dispatch.state === 'proposed' ? 'accent' : 'ok'}
      testId="graph-node-dispatch"
      ariaLabel={`Dispatch ${dispatch.state} for ${incident?.location ?? dispatch.incident_id}`}
      selectTarget={data.selectTarget}
      onSelect={data.onSelect}
    >
      <div className="cmd-graph-node__head">
        <Badge variant={dispatch.state === 'proposed' ? 'accent' : 'ok'} dot>
          {dispatch.state === 'proposed' ? 'Gemma proposes' : dispatch.state}
        </Badge>
      </div>
      <strong className="cmd-graph-node__title">
        {resource?.label ?? dispatch.resource_id}
      </strong>
      <p>{shortText(dispatch.rationale ?? `Linked to ${incident?.location ?? dispatch.incident_id}`)}</p>
      <div className="cmd-graph-node__actions">
        {dispatch.state === 'proposed' && (
          <Button
            size="sm"
            variant="confirm"
            onClick={() => data.onConfirm(dispatch)}
            disabled={data.busy}
          >
            {data.busy ? 'Confirming...' : 'Confirm'}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => data.onSelect(data.selectTarget)}>
          Details
        </Button>
      </div>
    </GraphShellNode>
  );
}

function ResourceNode({ data }) {
  const resource = data.resource;
  const available = resource.status === 'available' && (!resource.field_status || resource.field_status === 'idle');
  return (
    <GraphShellNode
      tone={available ? 'ok' : 'muted'}
      testId="graph-node-resource"
      ariaLabel={`Resource ${resource.label}`}
      selectTarget={data.selectTarget}
      onSelect={data.onSelect}
    >
      <div className="cmd-graph-node__head">
        <Badge variant={available ? 'ok' : 'muted'} dot>
          {resource.field_status && resource.field_status !== 'idle' ? resource.field_status : resource.status}
        </Badge>
        <Badge variant="muted">{resource.type}</Badge>
      </div>
      <strong className="cmd-graph-node__title">{resource.label}</strong>
      <p>{resource.location ?? 'No location'} · {resource.capacity ?? 'capacity unknown'}</p>
      {resource.quantity != null && (
        <div className="cmd-graph-node__meta">
          <span>{resource.quantity} {resource.unit || 'units'}</span>
        </div>
      )}
    </GraphShellNode>
  );
}

function AlertNode({ data }) {
  const alert = data.alert;
  return (
    <GraphShellNode
      tone={alert.severity ?? 'warn'}
      testId="graph-node-alert"
      ariaLabel={`Alert ${alert.message ?? alert.id}`}
      selectTarget={data.selectTarget}
      onSelect={data.onSelect}
    >
      <div className="cmd-graph-node__head">
        <Badge variant={alert.severity === 'critical' ? 'critical' : 'warn'} dot>
          {alert.severity ?? 'warning'}
        </Badge>
        <Badge variant="muted">{alert.zone ?? 'all zones'}</Badge>
      </div>
      <strong className="cmd-graph-node__title">Broadcast alert</strong>
      <p>{shortText(alert.message, 100)}</p>
    </GraphShellNode>
  );
}

function ReportNode({ data }) {
  const report = data.report;
  return (
    <GraphShellNode
      tone="field"
      testId="graph-node-report"
      ariaLabel={`Report evidence from ${report.source_device ?? report.reported_by ?? report.id}`}
      selectTarget={data.selectTarget}
      onSelect={data.onSelect}
    >
      <div className="cmd-graph-node__head">
        <Badge variant="accent" dot>
          Report evidence
        </Badge>
        {report.lang && <Badge variant="muted">{report.lang}</Badge>}
      </div>
      <strong className="cmd-graph-node__title">
        {report.source_device ?? report.reported_by ?? 'Unknown source'}
      </strong>
      <p>{shortText(report.raw_text, 110)}</p>
      <div className="cmd-graph-node__meta">
        {report.created_at && <span>{new Date(report.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        {report.parsed_into && <span>parsed</span>}
      </div>
    </GraphShellNode>
  );
}

function PersonNode({ data }) {
  const person = data.person;
  return (
    <GraphShellNode
      tone={person.status === 'missing' ? 'critical' : 'ok'}
      testId="graph-node-person"
      ariaLabel={`Person ${person.name ?? person.id} is ${person.status ?? 'unknown'}`}
      selectTarget={data.selectTarget}
      onSelect={data.onSelect}
    >
      <div className="cmd-graph-node__head">
        <Badge variant={person.status === 'missing' ? 'critical' : 'ok'} dot>
          {person.status ?? 'person'}
        </Badge>
        {person.matched != null && <Badge variant="muted">{person.matched ? 'matched' : 'unmatched'}</Badge>}
      </div>
      <strong className="cmd-graph-node__title">{person.name ?? 'Unnamed person'}</strong>
      <p>{shortText(person.detail, 100)}</p>
      <div className="cmd-graph-node__meta">
        {person.incident_id && <span>incident linked</span>}
        {person.report_id && <span>source report</span>}
      </div>
    </GraphShellNode>
  );
}

function IntakeNode({ data }) {
  return (
    <GraphShellNode tone="field">
      <div className="cmd-graph-node__head">
        <Badge variant="accent" dot>
          Field intake
        </Badge>
      </div>
      <strong className="cmd-graph-node__title">Reports enter the graph</strong>
      <p>Voice, photo, GPS and queued field reports feed Gemma before they become incidents.</p>
      <div className="cmd-graph-node__meta">
        <span>{data.incidentCount} incidents tracked</span>
      </div>
    </GraphShellNode>
  );
}

// Non-interactive column heading; the wrapper node is pointer-events: none
// (commandGraph.css) so it never intercepts clicks meant for the pane.
function SectionLabelNode({ data }) {
  return (
    <div className="cmd-graph-section-label" aria-hidden="true">
      {data.label}
    </div>
  );
}

const nodeTypes = {
  gemma: GemmaNode,
  incident: IncidentNode,
  dispatch: DispatchNode,
  resource: ResourceNode,
  alert: AlertNode,
  report: ReportNode,
  person: PersonNode,
  intake: IntakeNode,
  sectionLabel: SectionLabelNode,
};

function CommandGraph() {
  const [incidents, setIncidents] = useState([]);
  const [resources, setResources] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [reports, setReports] = useState([]);
  const [persons, setPersons] = useState([]);
  const [seq, setSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectedGraphItem, setSelectedGraphItem] = useState(null);
  const [graphFilter, setGraphFilter] = useState('all');
  // Positions the operator dragged nodes to, keyed by node id. Layout memos
  // recompute deterministic positions every sync; these overrides win so a
  // hand-arranged graph survives the 4s poll.
  const [nodeOverrides, setNodeOverrides] = useState({});
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [rematchBusyId, setRematchBusyId] = useState(null);
  const [sitrepOpen, setSitrepOpen] = useState(false);
  const [sitrep, setSitrep] = useState(null);
  const [sitrepLoading, setSitrepLoading] = useState(false);
  const [sitrepError, setSitrepError] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [alertComposerOpen, setAlertComposerOpen] = useState(false);
  const seqRef = useRef(0);
  const flowRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [syncResult, reportsResult, personsResult] = await Promise.allSettled([
        getSync(seqRef.current),
        getReports([]),
        getPersons(),
      ]);
      if (syncResult.status === 'rejected') throw syncResult.reason;
      const data = syncResult.value;
      if (Array.isArray(data.incidents)) setIncidents((prev) => mergeById(prev, data.incidents));
      if (Array.isArray(data.resources)) setResources((prev) => mergeById(prev, data.resources));
      if (Array.isArray(data.dispatches)) setDispatches((prev) => mergeById(prev, data.dispatches));
      if (Array.isArray(data.alerts)) setAlerts((prev) => mergeById(prev, data.alerts));
      if (Array.isArray(data.reports)) setReports((prev) => mergeById(prev, data.reports));
      if (Array.isArray(data.persons)) setPersons((prev) => mergeById(prev, data.persons));
      if (reportsResult.status === 'fulfilled' && Array.isArray(reportsResult.value)) {
        setReports(reportsResult.value);
      }
      if (personsResult.status === 'fulfilled' && Array.isArray(personsResult.value)) {
        setPersons(personsResult.value);
      }
      if (typeof data.seq === 'number') {
        seqRef.current = data.seq;
        setSeq(data.seq);
      }
      setSyncError(null);
      const syncedAt = new Date();
      setLastSync(syncedAt);
      setNow(syncedAt.getTime());
    } catch (error) {
      setSyncError(error.message || 'sync failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const escalated = useWatchdog(incidents, dispatches);
  const ordered = useMemo(() => sortByPriority(incidents), [incidents]);

  const dispatchesByIncident = useMemo(() => {
    const map = {};
    for (const dispatch of dispatches) {
      if (!map[dispatch.incident_id]) map[dispatch.incident_id] = [];
      map[dispatch.incident_id].push(dispatch);
    }
    return map;
  }, [dispatches]);

  const dispatchByIncident = useMemo(() => {
    const map = {};
    for (const [incidentId, incidentDispatches] of Object.entries(dispatchesByIncident)) {
      map[incidentId] =
        incidentDispatches.find((dispatch) => dispatch.state === 'proposed') ??
        incidentDispatches.find((dispatch) => ['confirmed', 'accepted', 'en_route', 'on_site'].includes(dispatch.state)) ??
        incidentDispatches[0];
    }
    return map;
  }, [dispatchesByIncident]);

  const dispatchById = useMemo(() => {
    const map = {};
    for (const dispatch of dispatches) map[dispatch.id] = dispatch;
    return map;
  }, [dispatches]);

  const incidentById = useMemo(() => {
    const map = {};
    for (const incident of incidents) map[incident.id] = incident;
    return map;
  }, [incidents]);

  const resourceById = useMemo(() => {
    const map = {};
    for (const resource of resources) map[resource.id] = resource;
    return map;
  }, [resources]);

  const reportById = useMemo(() => {
    const map = {};
    for (const report of reports) map[report.id] = report;
    return map;
  }, [reports]);

  const personById = useMemo(() => {
    const map = {};
    for (const person of persons) map[person.id] = person;
    return map;
  }, [persons]);

  const availableResources = useMemo(
    () => resources.filter((resource) => resource.status === 'available'),
    [resources],
  );

  const proposals = useMemo(
    () => dispatches.filter((dispatch) => dispatch.state === 'proposed'),
    [dispatches],
  );

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => alert.active !== false),
    [alerts],
  );

  const selectGraphItem = useCallback((target) => {
    setSelectedGraphItem(target);
  }, []);

  const selectedIncident = useMemo(() => {
    if (!selectedGraphItem) return null;
    if (selectedGraphItem.incidentId) return incidentById[selectedGraphItem.incidentId] ?? null;
    if (selectedGraphItem.type === 'dispatch') {
      const dispatch = dispatchById[selectedGraphItem.dispatchId];
      return dispatch ? incidentById[dispatch.incident_id] ?? null : null;
    }
    if (selectedGraphItem.type === 'report') {
      const report = reportById[selectedGraphItem.reportId];
      return report?.parsed_into ? incidentById[report.parsed_into] ?? null : null;
    }
    if (selectedGraphItem.type === 'person') {
      const person = personById[selectedGraphItem.personId];
      return person?.incident_id ? incidentById[person.incident_id] ?? null : null;
    }
    return null;
  }, [dispatchById, incidentById, personById, reportById, selectedGraphItem]);

  const selectedDispatch = selectedGraphItem?.type === 'dispatch'
    ? dispatchById[selectedGraphItem.dispatchId] ?? null
    : selectedIncident
      ? dispatchByIncident[selectedIncident.id] ?? null
      : null;
  const selectedResource = selectedGraphItem?.type === 'resource'
    ? resourceById[selectedGraphItem.resourceId] ?? null
    : selectedDispatch
      ? resourceById[selectedDispatch.resource_id] ?? null
      : null;
  const selectedReport = selectedGraphItem?.type === 'report' ? reportById[selectedGraphItem.reportId] ?? null : null;
  const selectedPerson = selectedGraphItem?.type === 'person' ? personById[selectedGraphItem.personId] ?? null : null;
  const selectedAlert = selectedGraphItem?.type === 'alert' ? activeAlerts.find((alert) => alert.id === selectedGraphItem.alertId) ?? null : null;

  const openSitrep = useCallback(async () => {
    setSitrepOpen(true);
    setSitrepLoading(true);
    setSitrepError(null);
    try {
      const nextSitrep = await getSitrep();
      setSitrep(nextSitrep);
    } catch (error) {
      setSitrepError(error.message || 'Failed to generate sitrep');
    } finally {
      setSitrepLoading(false);
    }
  }, []);

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
      } catch (error) {
        setSyncError(error.message || 'dispatch failed');
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

  const handleRematch = useCallback(
    async (incidentId) => {
      setRematchBusyId(incidentId);
      try {
        await rematchIncident(incidentId);
        await refresh();
      } catch (error) {
        setSyncError(error.message || 'rematch failed');
      } finally {
        setRematchBusyId(null);
      }
    },
    [refresh],
  );

  const handleDeactivateAlert = useCallback(
    async (alert) => {
      try {
        await deactivateAlert(alert.id);
        await refresh();
        setSelectedGraphItem(null);
      } catch (error) {
        setSyncError(error.message || 'alert deactivate failed');
      }
    },
    [refresh],
  );

  // Escape dismisses the topmost graph surface: the map overlay first (it has
  // no Escape handler of its own), then the inspector. SitrepModal and
  // AlertComposer sit above both and own their window Escape handlers.
  useEffect(() => {
    if (!selectedGraphItem && !mapOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (sitrepOpen || alertComposerOpen) return;
      if (mapOpen) {
        setMapOpen(false);
        return;
      }
      setSelectedGraphItem(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedGraphItem, sitrepOpen, alertComposerOpen, mapOpen]);

  const visibleIncidents = useMemo(
    () => ordered.filter((incident) => incident.status !== 'resolved').slice(0, 12),
    [ordered],
  );

  // Single source of truth for what the graph shows: the active filter picks
  // the incidents (or the people/report chains), then only their connected
  // nodes stay visible. Both the nodes and edges memos read from this.
  const visibleGraph = useMemo(() => {
    if (graphFilter === 'people') {
      const graphPersons = persons.slice(0, 16);
      const personIncidentIds = new Set(graphPersons.map((person) => person.incident_id).filter(Boolean));
      const personReportIds = new Set(graphPersons.map((person) => person.report_id).filter(Boolean));
      return {
        incidents: visibleIncidents.filter((incident) => personIncidentIds.has(incident.id)),
        reports: reports.filter((report) => personReportIds.has(report.id)).slice(0, 24),
        persons: graphPersons,
        dispatches: [],
        resources: [],
        alerts: [],
      };
    }
    if (graphFilter === 'reports') {
      const visibleIncidentIds = new Set(visibleIncidents.map((incident) => incident.id));
      const graphReports = reports
        .filter((report) => visibleIncidentIds.has(report.parsed_into))
        .slice(0, 24);
      const reportIncidentIds = new Set(graphReports.map((report) => report.parsed_into));
      return {
        incidents: visibleIncidents.filter((incident) => reportIncidentIds.has(incident.id)),
        reports: graphReports,
        persons: [],
        dispatches: [],
        resources: [],
        alerts: [],
      };
    }

    let graphIncidents = visibleIncidents;
    if (graphFilter === 'critical') {
      graphIncidents = visibleIncidents.filter((incident) => incident.urgency === 'critical');
    } else if (graphFilter === 'open') {
      graphIncidents = visibleIncidents.filter((incident) => incident.status === 'open');
    } else if (graphFilter === 'dispatch') {
      graphIncidents = visibleIncidents.filter((incident) => (dispatchesByIncident[incident.id] ?? []).length > 0);
    }
    const incidentIds = new Set(graphIncidents.map((incident) => incident.id));
    const graphReports = reports
      .filter((report) => incidentIds.has(report.parsed_into))
      .slice(0, 24);
    const graphPersons = persons
      .filter((person) => (graphFilter === 'all' && !person.incident_id) || incidentIds.has(person.incident_id))
      .slice(0, 16);
    const graphDispatches = dispatches
      .filter((dispatch) => incidentIds.has(dispatch.incident_id))
      .slice(0, 16);
    const resourceIdsFromDispatches = new Set(graphDispatches.map((dispatch) => dispatch.resource_id));
    const graphResources = resources
      .filter((resource) =>
        resourceIdsFromDispatches.has(resource.id) ||
        (graphFilter === 'all' && resource.status === 'available'))
      .slice(0, 16);
    const graphAlerts = activeAlerts
      .filter((alert) =>
        graphFilter === 'all' ||
        graphIncidents.some((incident) => alertRelatesToIncident(alert, incident)))
      .slice(0, 4);
    return {
      incidents: graphIncidents,
      reports: graphReports,
      persons: graphPersons,
      dispatches: graphDispatches,
      resources: graphResources,
      alerts: graphAlerts,
    };
  }, [activeAlerts, dispatches, dispatchesByIncident, graphFilter, persons, reports, resources, visibleIncidents]);

  const nodes = useMemo(() => {
    const {
      incidents: graphIncidents,
      reports: visibleReports,
      persons: visiblePersons,
      dispatches: visibleDispatches,
      resources: visibleResources,
      alerts: visibleAlerts,
    } = visibleGraph;

    // People start below the last visible report so the two x=-520 columns
    // can never collide, however many reports are shown (deterministic).
    const personColumnY = visibleReports.length > 0
      ? GRAPH_LAYOUT.report.y + visibleReports.length * GRAPH_LAYOUT.report.gap + PERSON_SECTION_BREAK
      : GRAPH_LAYOUT.report.y;

    const reportNodes = visibleReports.map((report, index) => ({
      id: `report-${report.id}`,
      type: 'report',
      position: {
        x: GRAPH_LAYOUT.report.x,
        y: GRAPH_LAYOUT.report.y + index * GRAPH_LAYOUT.report.gap,
      },
      data: {
        report,
        selectTarget: { type: 'report', reportId: report.id, incidentId: report.parsed_into },
        onSelect: selectGraphItem,
      },
    }));

    const personNodes = visiblePersons.map((person, index) => ({
      id: `person-${person.id}`,
      type: 'person',
      position: {
        x: GRAPH_LAYOUT.person.x,
        y: personColumnY + index * GRAPH_LAYOUT.person.gap,
      },
      data: {
        person,
        selectTarget: { type: 'person', personId: person.id, incidentId: person.incident_id },
        onSelect: selectGraphItem,
      },
    }));

    const incidentNodes = graphIncidents.map((incident, index) => {
      const dispatch = dispatchByIncident[incident.id];
      const needsAction =
        incident.status === 'open' &&
        (!dispatch || dispatch.state === 'withdrawn' || escalated[incident.id]?.escalated);
      return {
        id: `incident-${incident.id}`,
        type: 'incident',
        position: {
          x: GRAPH_LAYOUT.incident.x,
          y: GRAPH_LAYOUT.incident.y + index * GRAPH_LAYOUT.incident.gap,
        },
        data: {
          incident,
          selectTarget: { type: 'incident', incidentId: incident.id },
          onSelect: selectGraphItem,
          needsAction,
          rematchBusy: rematchBusyId === incident.id,
          onRematch: handleRematch,
        },
      };
    });

    const dispatchNodes = visibleDispatches.map((dispatch, index) => ({
      id: `dispatch-${dispatch.id}`,
      type: 'dispatch',
      position: {
        x: GRAPH_LAYOUT.dispatch.x,
        y: GRAPH_LAYOUT.dispatch.y + index * GRAPH_LAYOUT.dispatch.gap,
      },
      data: {
        dispatch,
        incident: incidentById[dispatch.incident_id],
        resource: resourceById[dispatch.resource_id],
        selectTarget: { type: 'dispatch', dispatchId: dispatch.id, incidentId: dispatch.incident_id },
        onSelect: selectGraphItem,
        busy: dispatchBusy,
        onConfirm: handleConfirm,
      },
    }));

    const resourceNodes = visibleResources.map((resource, index) => ({
      id: `resource-${resource.id}`,
      type: 'resource',
      position: {
        x: GRAPH_LAYOUT.resource.x,
        y: GRAPH_LAYOUT.resource.y + index * GRAPH_LAYOUT.resource.gap,
      },
      data: {
        resource,
        selectTarget: { type: 'resource', resourceId: resource.id },
        onSelect: selectGraphItem,
      },
    }));

    const alertNodes = visibleAlerts.map((alert, index) => ({
      id: `alert-${alert.id}`,
      type: 'alert',
      position: {
        x: GRAPH_LAYOUT.alert.x + index * GRAPH_LAYOUT.alert.gap,
        y: GRAPH_LAYOUT.alert.y,
      },
      data: {
        alert,
        selectTarget: { type: 'alert', alertId: alert.id },
        onSelect: selectGraphItem,
      },
    }));

    // Column headings — rendered as pointer-events: none nodes so they pan
    // and zoom with their columns without intercepting clicks.
    const sectionLabelNodes = [];
    const addSectionLabel = (id, label, x, y) => {
      sectionLabelNodes.push({
        id,
        type: 'sectionLabel',
        position: { x, y },
        draggable: false,
        selectable: false,
        focusable: false,
        data: { label },
      });
    };
    addSectionLabel('label-gemma', 'Gemma', GRAPH_LAYOUT.intake.x, GRAPH_LAYOUT.intake.y - SECTION_LABEL_OFFSET);
    if (visibleReports.length > 0) {
      addSectionLabel('label-reports', 'Reports', GRAPH_LAYOUT.report.x, GRAPH_LAYOUT.report.y - SECTION_LABEL_OFFSET);
    }
    if (visiblePersons.length > 0) {
      addSectionLabel('label-people', 'People', GRAPH_LAYOUT.person.x, personColumnY - SECTION_LABEL_OFFSET);
    }
    if (graphIncidents.length > 0) {
      addSectionLabel('label-situations', 'Situations', GRAPH_LAYOUT.incident.x, GRAPH_LAYOUT.incident.y - SECTION_LABEL_OFFSET);
    }
    if (visibleDispatches.length > 0) {
      addSectionLabel('label-dispatches', 'Dispatches', GRAPH_LAYOUT.dispatch.x, GRAPH_LAYOUT.dispatch.y - SECTION_LABEL_OFFSET);
    }
    if (visibleResources.length > 0) {
      addSectionLabel('label-resources', 'Resources', GRAPH_LAYOUT.resource.x, GRAPH_LAYOUT.resource.y - SECTION_LABEL_OFFSET);
    }

    return [
      ...sectionLabelNodes,
      {
        id: 'field-intake',
        type: 'intake',
        position: GRAPH_LAYOUT.intake,
        data: { incidentCount: incidents.length },
      },
      {
        id: 'gemma-brain',
        type: 'gemma',
        position: GRAPH_LAYOUT.brain,
        data: {
          openCount: ordered.filter((incident) => incident.status === 'open').length,
          proposalCount: proposals.length,
          availableCount: availableResources.length,
          onSitrep: openSitrep,
          onChat: () => setChatOpen(true),
        },
      },
      ...alertNodes,
      ...reportNodes,
      ...personNodes,
      ...incidentNodes,
      ...dispatchNodes,
      ...resourceNodes,
    ];
  }, [
    availableResources.length,
    dispatchBusy,
    dispatchByIncident,
    escalated,
    handleConfirm,
    handleRematch,
    incidents.length,
    incidentById,
    openSitrep,
    ordered,
    proposals,
    rematchBusyId,
    resourceById,
    selectGraphItem,
    visibleGraph,
  ]);

  // Drag support: React Flow is controlled here (nodes come from the memo
  // above), so position changes must be captured and re-applied or nodes
  // snap back on the next sync repaint.
  const handleNodesChange = useCallback((changes) => {
    setNodeOverrides((prev) => {
      let next = prev;
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue;
        if (next === prev) next = { ...prev };
        next[change.id] = change.position;
      }
      return next;
    });
  }, []);

  const hasCustomLayout = Object.keys(nodeOverrides).length > 0;

  const positionedNodes = useMemo(() => {
    if (!hasCustomLayout) return nodes;
    return nodes.map((node) =>
      nodeOverrides[node.id] ? { ...node, position: nodeOverrides[node.id] } : node,
    );
  }, [hasCustomLayout, nodeOverrides, nodes]);

  const nodeSetKey = useMemo(
    () => nodes.map((node) => node.id).sort().join('|'),
    [nodes],
  );

  useEffect(() => {
    // Auto-refit when the node set changes — but never fight the operator:
    // once they've dragged nodes around, leave the viewport alone.
    if (!flowRef.current || hasCustomLayout) return undefined;
    const frame = requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.18, duration: 350 });
    });
    return () => cancelAnimationFrame(frame);
  }, [nodeSetKey, hasCustomLayout]);

  const resetLayout = useCallback(() => {
    setNodeOverrides({});
    requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.18, duration: 350 });
    });
  }, []);

  const edges = useMemo(() => {
    const {
      incidents: graphIncidents,
      reports: visibleReports,
      persons: visiblePersons,
      dispatches: visibleDispatches,
      resources: visibleResources,
      alerts: visibleAlerts,
    } = visibleGraph;
    const nodeIds = new Set([
      'field-intake',
      'gemma-brain',
      ...graphIncidents.map((incident) => `incident-${incident.id}`),
      ...visibleReports.map((report) => `report-${report.id}`),
      ...visiblePersons.map((person) => `person-${person.id}`),
      ...visibleDispatches.map((dispatch) => `dispatch-${dispatch.id}`),
      ...visibleResources.map((resource) => `resource-${resource.id}`),
      ...visibleAlerts.map((alert) => `alert-${alert.id}`),
    ]);

    const addEdge = (list, edge) => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
      list.push({
        type: 'smoothstep',
        ...edge,
      });
    };

    const graphEdges = [
      {
        id: 'field-to-gemma',
        source: 'field-intake',
        target: 'gemma-brain',
        animated: true,
        type: 'smoothstep',
        className: 'cmd-graph-edge cmd-graph-edge--brain',
      },
    ];

    for (const report of visibleReports) {
      addEdge(graphEdges, {
        id: `report-${report.id}-gemma`,
        source: `report-${report.id}`,
        target: 'gemma-brain',
        animated: true,
        className: 'cmd-graph-edge cmd-graph-edge--evidence',
      });
      addEdge(graphEdges, {
        id: `report-${report.id}-incident-${report.parsed_into}`,
        source: `report-${report.id}`,
        target: `incident-${report.parsed_into}`,
        className: 'cmd-graph-edge cmd-graph-edge--evidence',
      });
    }

    for (const incident of graphIncidents) {
      addEdge(graphEdges, {
        id: `gemma-incident-${incident.id}`,
        source: 'gemma-brain',
        target: `incident-${incident.id}`,
        animated: incident.status === 'open',
        className: 'cmd-graph-edge cmd-graph-edge--brain',
      });
      if (incident.status === 'open' && (!dispatchByIncident[incident.id] || escalated[incident.id]?.escalated)) {
        addEdge(graphEdges, {
          id: `incident-${incident.id}-gemma-loop`,
          source: `incident-${incident.id}`,
          target: 'gemma-brain',
          animated: true,
          className: `cmd-graph-edge cmd-graph-edge--${incident.urgency}`,
        });
      }
    }

    for (const dispatch of visibleDispatches) {
      addEdge(graphEdges, {
        id: `incident-${dispatch.incident_id}-dispatch-${dispatch.id}`,
        source: `incident-${dispatch.incident_id}`,
        target: `dispatch-${dispatch.id}`,
        animated: dispatch.state === 'proposed',
        className: 'cmd-graph-edge cmd-graph-edge--dispatch',
      });
      addEdge(graphEdges, {
        id: `dispatch-${dispatch.id}-resource-${dispatch.resource_id}`,
        source: `dispatch-${dispatch.id}`,
        target: `resource-${dispatch.resource_id}`,
        className: 'cmd-graph-edge cmd-graph-edge--dispatch',
      });
    }

    for (const person of visiblePersons) {
      if (person.incident_id) {
        addEdge(graphEdges, {
          id: `person-${person.id}-incident-${person.incident_id}`,
          source: `person-${person.id}`,
          target: `incident-${person.incident_id}`,
          className: 'cmd-graph-edge cmd-graph-edge--person',
        });
      }
      if (person.report_id) {
        addEdge(graphEdges, {
          id: `person-${person.id}-report-${person.report_id}`,
          source: `person-${person.id}`,
          target: `report-${person.report_id}`,
          className: 'cmd-graph-edge cmd-graph-edge--person',
        });
      }
    }

    for (const alert of visibleAlerts) {
      const relatedIncidents = alert.zone
        ? graphIncidents.filter((incident) => alertRelatesToIncident(alert, incident))
        : graphIncidents.slice(0, 3);
      addEdge(graphEdges, {
        id: `gemma-alert-${alert.id}`,
        source: 'gemma-brain',
        target: `alert-${alert.id}`,
        className: 'cmd-graph-edge cmd-graph-edge--alert',
      });
      for (const incident of relatedIncidents.slice(0, 4)) {
        addEdge(graphEdges, {
          id: `alert-${alert.id}-incident-${incident.id}`,
          source: `alert-${alert.id}`,
          target: `incident-${incident.id}`,
          className: 'cmd-graph-edge cmd-graph-edge--alert',
        });
      }
    }

    return graphEdges;
  }, [dispatchByIncident, escalated, visibleGraph]);

  const connectedDispatches = useMemo(() => {
    if (selectedDispatch) return [selectedDispatch];
    if (selectedResource) return dispatches.filter((dispatch) => dispatch.resource_id === selectedResource.id);
    if (selectedIncident) return dispatchesByIncident[selectedIncident.id] ?? [];
    return [];
  }, [dispatches, dispatchesByIncident, selectedDispatch, selectedIncident, selectedResource]);

  const connectedReports = useMemo(() => {
    if (selectedReport) return [selectedReport];
    if (selectedPerson?.report_id && reportById[selectedPerson.report_id]) return [reportById[selectedPerson.report_id]];
    if (!selectedIncident) return [];
    const mergedIds = new Set(selectedIncident.merged_report_ids ?? []);
    return reports.filter((report) => report.parsed_into === selectedIncident.id || mergedIds.has(report.id));
  }, [reportById, reports, selectedIncident, selectedPerson, selectedReport]);

  const connectedResources = useMemo(() => {
    const map = new Map();
    if (selectedResource) map.set(selectedResource.id, selectedResource);
    for (const dispatch of connectedDispatches) {
      const resource = resourceById[dispatch.resource_id];
      if (resource) map.set(resource.id, resource);
    }
    return [...map.values()];
  }, [connectedDispatches, resourceById, selectedResource]);

  const connectedPersons = useMemo(() => {
    if (selectedPerson) return [selectedPerson];
    if (selectedReport) return persons.filter((person) => person.report_id === selectedReport.id);
    if (selectedIncident) return persons.filter((person) => person.incident_id === selectedIncident.id);
    return [];
  }, [persons, selectedIncident, selectedPerson, selectedReport]);

  const connectedAlerts = useMemo(() => {
    if (selectedAlert) return [selectedAlert];
    if (selectedIncident) return activeAlerts.filter((alert) => alertRelatesToIncident(alert, selectedIncident));
    return [];
  }, [activeAlerts, selectedAlert, selectedIncident]);

  return (
    <div className="bru-app cmd-root cmd-graph-root">
      <header className="cmd-topbar cmd-graph-topbar">
        <div className="cmd-topbar__brand">
          <img
            className="cmd-topbar__logo"
            src="/logo-animated.svg"
            alt="Brujula graph command"
            width="60"
            height="60"
          />
          <div className="cmd-topbar__wordmark">
            <div className="cmd-topbar__title">BRUJULA</div>
            <div className="cmd-topbar__sub">Node Graph Command · Gemma Brain</div>
          </div>
        </div>

        <div className="cmd-topbar__status">
          <span className={`cmd-sync ${syncError ? 'cmd-sync--err' : ''}`} title={`sync seq ${seq}`}>
            <span className="cmd-sync__dot" aria-hidden="true" />
            {syncError ? 'SYNC ERROR' : lastSync ? `synced ${formatSyncAge(lastSync, now)}` : 'CONNECTING...'}
          </span>
          {USE_MOCKS && <Badge variant="muted">MOCK DATA</Badge>}
        </div>

        <div className="cmd-topbar__actions">
          <Button variant="default" onClick={() => setMapOpen(true)} aria-label="Open compact map">
            <Icon name="location" />
            Map
          </Button>
          <Button variant="default" onClick={() => setAlertComposerOpen(true)} aria-label="Broadcast alert">
            <Icon name="alert" />
            Alert
          </Button>
          <Button variant="primary" onClick={openSitrep}>
            <Icon name="sitrep" />
            SITREP
          </Button>
          <Button variant="ghost" onClick={refresh} disabled={loading}>
            <Icon name="refresh" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="cmd-graph-main" aria-label="Node command graph">
        {loading && incidents.length === 0 ? (
          <div className="cmd-graph-loading" role="status">
            Loading command graph...
          </div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={positionedNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.15}
              maxZoom={2}
              nodesDraggable
              nodesConnectable={false}
              panOnDrag
              zoomOnScroll
              zoomOnPinch
              zoomOnDoubleClick
              onInit={(instance) => {
                flowRef.current = instance;
              }}
              onNodeClick={(_, node) => {
                if (node.data?.selectTarget) selectGraphItem(node.data.selectTarget);
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="rgba(140, 170, 150, 0.18)" gap={28} size={1} />
              <Controls position="bottom-left" />
              <Panel position="top-left" className="cmd-graph-filters" role="group" aria-label="Graph filters">
                {GRAPH_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className="cmd-graph-filters__chip"
                    aria-pressed={graphFilter === filter.id}
                    onClick={() => setGraphFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
                {hasCustomLayout && (
                  <button
                    type="button"
                    className="cmd-graph-filters__chip cmd-graph-filters__chip--reset"
                    onClick={resetLayout}
                  >
                    Reset layout
                  </button>
                )}
              </Panel>
              <Panel position="bottom-right" className="cmd-graph-legend" aria-label="Edge color legend">
                <strong>Edge colors</strong>
                <ul>
                  <li>
                    <span className="cmd-graph-legend__swatch cmd-graph-legend__swatch--evidence" aria-hidden="true" />
                    Report evidence
                  </li>
                  <li>
                    <span className="cmd-graph-legend__swatch cmd-graph-legend__swatch--brain" aria-hidden="true" />
                    Gemma / AI
                  </li>
                  <li>
                    <span className="cmd-graph-legend__swatch cmd-graph-legend__swatch--dispatch" aria-hidden="true" />
                    Dispatch / resource
                  </li>
                  <li>
                    <span className="cmd-graph-legend__swatch cmd-graph-legend__swatch--person" aria-hidden="true" />
                    Person
                  </li>
                  <li>
                    <span className="cmd-graph-legend__swatch cmd-graph-legend__swatch--alert" aria-hidden="true" />
                    Alert
                  </li>
                  <li>
                    <span className="cmd-graph-legend__swatch cmd-graph-legend__swatch--critical" aria-hidden="true" />
                    Critical re-match loop
                  </li>
                  <li>
                    <span className="cmd-graph-legend__swatch cmd-graph-legend__swatch--high" aria-hidden="true" />
                    High-urgency re-match loop
                  </li>
                </ul>
              </Panel>
            </ReactFlow>
          </ReactFlowProvider>
        )}
      </main>

      {chatOpen && (
        <aside className="cmd-graph-chat" aria-label="Gemma chat panel">
          <div className="cmd-graph-chat__head">
            <strong>Gemma Context</strong>
            <Button size="sm" variant="ghost" onClick={() => setChatOpen(false)} aria-label="Close Gemma chat">
              <Icon name="close" />
            </Button>
          </div>
          <ContextChat station="command" dataApi={dataSource} />
        </aside>
      )}

      {mapOpen && (
        <div className="cmd-graph-overlay" onClick={() => setMapOpen(false)}>
          <div
            className="cmd-graph-overlay__panel cmd-graph-overlay__panel--map"
            role="dialog"
            aria-modal="true"
            aria-label="Incident map"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="cmd-graph-overlay__head">
              <strong>Map</strong>
              <Button size="sm" variant="ghost" onClick={() => setMapOpen(false)} aria-label="Close map">
                <Icon name="close" />
              </Button>
            </div>
            <MapPanel
              incidents={ordered}
              onSelect={(incidentId) => selectGraphItem({ type: 'incident', incidentId })}
            />
          </div>
        </div>
      )}

      {selectedGraphItem && (
        <GraphInspector
          selectedGraphItem={selectedGraphItem}
          incident={selectedIncident}
          dispatch={selectedDispatch}
          resource={selectedResource}
          report={selectedReport}
          person={selectedPerson}
          alert={selectedAlert}
          connectedReports={connectedReports}
          connectedDispatches={connectedDispatches}
          connectedResources={connectedResources}
          connectedPersons={connectedPersons}
          connectedAlerts={connectedAlerts}
          incidentById={incidentById}
          resourceById={resourceById}
          availableResources={availableResources}
          dispatchBusy={dispatchBusy}
          rematchBusy={rematchBusyId === selectedIncident?.id}
          escalated={selectedIncident ? escalated[selectedIncident.id] : null}
          onClose={() => setSelectedGraphItem(null)}
          onSelect={selectGraphItem}
          onConfirm={(dispatch) => handleConfirm(dispatch)}
          onOverride={handleOverride}
          onOpenSitrep={openSitrep}
          onRematchIncident={handleRematch}
          onPatchIncident={async () => {
            await refresh();
          }}
          onDeactivateAlert={handleDeactivateAlert}
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
    </div>
  );
}

export default CommandGraph;
