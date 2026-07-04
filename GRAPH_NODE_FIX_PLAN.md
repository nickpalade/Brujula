# Node Graph Fix Plan

## Goal

Turn `/graph` from a visual summary into the main command interface for understanding a disaster situation. The graph should let an operator click any situation and immediately see the connected reports, Gemma decisions, dispatches, resources, alerts, people, and map context through the sidebar or focused popups.

The intended mental model:

```text
Field reports -> Gemma parse/dedup/match -> incidents -> dispatches -> resources
                                      \-> people registry
                                      \-> alerts / hazards / SITREP / chat context
```

## Current Manual Test Findings

Manual Playwright testing against `http://localhost:5174/graph` found:

- The graph loads live backend data.
- The graph rendered `20` nodes and `11` edges.
- Topbar actions work: map, alert composer, SITREP, chat, refresh.
- Situation node body clicks do not open the sidebar.
- Node buttons such as `Inspect` are unreliable because the React Flow pane intercepts pointer events.
- Resource nodes do not open a related sidebar or popup.
- Alert nodes do not open a related sidebar or popup.
- Raw report nodes are not rendered.
- Missing-person/person nodes are not rendered.
- Confirmed, accepted, and on-site dispatches are not consistently visible.
- The graph currently shows a limited command summary, not the complete connected response picture.

## Target User Experience

An operator should be able to:

- Open `/graph` and see all active disaster response entities grouped around Gemma and incidents.
- Click an incident node and open the sidebar with all connected context.
- Click a report node and open the incident sidebar focused on that report evidence.
- Click a dispatch node and open the incident sidebar focused on the dispatch/resource decision.
- Click a resource node and see which incidents it is proposed for, committed to, or available for.
- Click a person node and see the related incident and source reports.
- Click an alert node and see affected incidents/resources by zone or category.
- Use the sidebar as the primary drill-down surface instead of needing separate screens.

## Phase 1: Fix React Flow Clickability

### Problem

React Flow pane interactions are intercepting pointer events on custom nodes. Normal Playwright/user clicks on node body and node buttons are unreliable.

### Changes

Files:

- `app/src/command/CommandGraph.jsx`
- `app/src/command/commandGraph.css`

Implementation:

- Add `onNodeClick` to `ReactFlow`.
- Make node data include a normalized `selectTarget`, for example:
  - `{ type: 'incident', incidentId }`
  - `{ type: 'report', reportId, incidentId }`
  - `{ type: 'dispatch', dispatchId, incidentId }`
  - `{ type: 'resource', resourceId }`
  - `{ type: 'person', personId, incidentId }`
  - `{ type: 'alert', alertId }`
- Centralize selection in graph state:
  - Replace `selectedId` with `selectedGraphItem`.
  - Derive `selectedIncident`, `selectedDispatch`, `selectedResource`, `selectedReport`, `selectedPerson`, and `selectedAlert`.
- Keep buttons, but do not rely on them as the only way to inspect a node.
- Add CSS to ensure node controls receive pointer events:
  - `.cmd-graph-node { pointer-events: all; }`
  - `.cmd-graph-node button { pointer-events: all; }`
- Add `data-testid` attributes to custom nodes:
  - `graph-node-incident`
  - `graph-node-report`
  - `graph-node-dispatch`
  - `graph-node-resource`
  - `graph-node-person`
  - `graph-node-alert`

Acceptance checks:

- Clicking an incident node body opens the sidebar.
- Clicking an incident node `Inspect` button opens the sidebar.
- Clicking a dispatch/resource/report/person/alert node opens the right detail surface.
- Playwright no longer reports React Flow pane pointer interception for node actions.

## Phase 2: Load Complete Graph Data

### Problem

The graph only tracks incidents, resources, dispatches, and alerts from `/api/sync`. Reports and people are either absent or passed as empty arrays.

### Changes

Files:

- `app/src/command/CommandGraph.jsx`
- `app/src/shared/api.js`
- Optional: `server/store.js`, `server/routes/hub.js`

Implementation:

- Track `reports` and `persons` in `CommandGraph` state.
- Fetch reports with `getReports()` on initial graph load and after refresh.
- Fetch persons with `getPersons()` on initial graph load and after refresh.
- If `/api/sync` does not include reports, keep reports as a separate full-list fetch.
- If `/api/sync` does not include persons reliably, fetch persons separately too.
- Pass real `persons` into `SitrepModal` instead of `persons={[]}`.
- Make `getReports([])` return all reports in live mode, while still preserving drawer behavior for `getReports(ids)`.

Acceptance checks:

- Graph state includes all reports from `/api/reports`.
- Graph state includes all people from `/api/persons`.
- SITREP modal receives real person context.
- Report and person counts in graph UI match backend counts.

## Phase 3: Render All Important Node Types

### Problem

The graph hides important context:

- Raw report evidence.
- Missing/found/safe people.
- Confirmed/accepted/on-site dispatches.
- Incident-resource lifecycle connections.

### Changes

Files:

- `app/src/command/CommandGraph.jsx`
- `app/src/command/commandGraph.css`

Add node types:

- `ReportNode`
  - Shows reporter/source device, language, age, short raw text.
  - Connects to Gemma and the parsed incident.
- `PersonNode`
  - Shows name, status, detail.
  - Connects to incident and source report.
- Expand `DispatchNode`
  - Render all dispatch states, not just `proposed`.
  - Badge states: `proposed`, `confirmed`, `accepted`, `en_route`, `on_site`, `done`, `withdrawn`.
- Expand `ResourceNode`
  - Show assignment state if committed/traveling/on-site.
  - Show all resources relevant to visible dispatches, plus available resources.
- Keep `AlertNode`
  - Add selection behavior and affected-context display.

Node limits:

- Show all open/dispatched incidents by default.
- For large data sets, cap with clear grouping:
  - Top `12` incidents by priority.
  - All reports connected to visible incidents, capped per incident if needed.
  - All dispatches connected to visible incidents.
  - All resources connected to visible dispatches, plus available critical resources.
  - All people connected to visible incidents.
  - Active alerts.

Acceptance checks:

- The simulated disaster report texts appear as graph report nodes.
- `Maria Lopez` appears as a person node if present in `/api/persons`.
- Confirmed and accepted dispatches appear as dispatch nodes.
- Resources connected to confirmed dispatches are visible.

## Phase 4: Build Relationship Edges

### Problem

Edges do not represent the full response chain.

### Changes

Files:

- `app/src/command/CommandGraph.jsx`

Required edge types:

- `report -> Gemma`
  - Field intake and evidence flow.
- `Gemma -> incident`
  - Parsed/deduped incident.
- `report -> incident`
  - Dedup evidence.
- `incident -> dispatch`
  - Decision/proposal/assignment.
- `dispatch -> resource`
  - Assigned capability.
- `person -> incident`
  - Missing/found/safe person linked to event.
- `person -> report`
  - Source report where person was mentioned.
- `alert -> incident`
  - Zone/category relevant alert.
- `incident -> Gemma`
  - Rematch/escalation loop only when an incident still needs AI action.

Edge styling:

- Critical incident edges: red.
- High urgency: amber.
- Gemma/AI edges: brand red.
- Report/evidence edges: muted blue/green.
- Dispatch/resource edges: accent.
- Person edges: purple or distinct muted tone.
- Alert edges: warning/critical tone.

Acceptance checks:

- Each visible incident has at least one incoming report edge when source reports exist.
- Each dispatch has both incident and resource edges.
- Each person node links to its incident.
- Alerts are visually connected instead of floating.

## Phase 5: Sidebar as Relationship Inspector

### Problem

`IncidentDrawer` only understands incident selection. Resource/alert/person/report clicks need useful detail surfaces.

### Changes

Files:

- `app/src/command/IncidentDrawer.jsx`
- `app/src/command/CommandGraph.jsx`
- Optional new file: `app/src/command/GraphInspector.jsx`

Recommended approach:

- Create `GraphInspector.jsx` as a wrapper sidebar.
- It receives:
  - `selectedGraphItem`
  - `incident`
  - `dispatch`
  - `resource`
  - `report`
  - `person`
  - `alert`
  - connected collections.
- For incident-like selections, reuse `IncidentDrawer` content or embed `IncidentDrawer`.
- For non-incident selections, show a relationship-focused sidebar with:
  - Selected item header.
  - Directly connected entities.
  - Actions to jump to related incident.

Inspector behavior by node:

- Incident:
  - Summary, location, urgency, people count, status.
  - All linked reports with raw text.
  - Dispatch lifecycle and resource.
  - Related persons.
  - Related alerts.
  - Actions: edit, resolve, rematch, confirm/override dispatch, SITREP.
- Report:
  - Raw text, reporter, source device, GPS, created time.
  - Parsed incident link.
  - Button: open incident view.
- Dispatch:
  - State, rationale, proposed_by_ai, confirmed time.
  - Incident and resource cards.
  - Actions: confirm/override/status update where valid.
- Resource:
  - Capability, location, capacity, quantity, status, field_status.
  - Current linked dispatches.
  - Incidents it is serving or proposed for.
- Person:
  - Name, status, detail, matched flag.
  - Source report and incident.
  - Button: open incident.
- Alert:
  - Message, severity, zone, active state.
  - Related incidents by zone/location text.
  - Action: deactivate if active.

Acceptance checks:

- Clicking any node opens a sidebar or focused popup with useful connected details.
- Sidebar includes jump links/buttons to related incident/resource/report.
- Sidebar never shows an empty generic drawer for non-incident nodes.

## Phase 6: Layout Improvements

### Problem

The current layout is column-based and limited. Adding reports/persons will get crowded without better grouping.

### Changes

Files:

- `app/src/command/CommandGraph.jsx`
- `app/src/command/commandGraph.css`

Layout proposal:

```text
Reports/People       Gemma Brain        Incidents          Dispatches          Resources
     |                    |                  |                  |                  |
     +--------------------+------------------+------------------+------------------+
                         Alerts / SITREP context across top
```

Implementation options:

- Manual deterministic positions for now:
  - Reports: `x = -520`
  - People: `x = -520`, lower section
  - Gemma: `x = -120`
  - Incidents: `x = 280`
  - Dispatches: `x = 700`
  - Resources: `x = 1100`
  - Alerts: top row
- Add section labels as non-interactive nodes or absolute overlay labels.
- Add a small legend explaining edge colors.
- Add graph filters:
  - `All`
  - `Critical only`
  - `Open only`
  - `With dispatch`
  - `People`
  - `Reports`

Acceptance checks:

- Important nodes do not overlap at `1440x900`.
- Fit view shows the whole response chain.
- Operators can visually follow report -> Gemma -> incident -> dispatch -> resource.

## Phase 7: Data Consistency Fixes

### Problem

Manual scenario testing exposed realistic model/pipeline artifacts:

- A resource-offer report can merge into a need incident and inflate `people_count`.
- A shelter report merged into a seeded shelter incident at a different location.
- The graph should make these corrections visible, not hide them.

### Changes

Files:

- `server/pipeline/index.js`
- `server/routes/hub.js`
- `app/src/command/CommandGraph.jsx`
- `app/src/command/IncidentDrawer.jsx`

Implementation:

- In graph/sidebar, show whether an incident was `corrected_by_human`.
- For report nodes, show parsed kind/category if available in future.
- Consider storing parsed report fields on the report record:
  - `parsed_kind`
  - `parsed_category`
  - `parsed_location`
  - `parsed_people_count`
  - `parsed_urgency`
- Prevent resource reports from increasing need `people_count` during merge.
- Tighten dedup prompt or deterministic backstop:
  - Resource reports should not dedup into need incidents unless explicitly intended.
  - Same category alone is not enough when locations differ significantly.

Acceptance checks:

- Human corrections are visible in graph/sidebar.
- Resource-offer reports do not inflate affected-person count.
- Merged report evidence clearly explains why multiple reports are connected.

## Phase 8: Accessibility and Operator Ergonomics

### Changes

- Nodes should be keyboard-focusable:
  - `tabIndex={0}`
  - `role="button"`
  - `aria-label` describing node type and target.
- Enter/Space on a node opens the inspector.
- Escape closes inspector/popups.
- Sidebar focus should move to the close button or header on open.
- Add clear labels:
  - `Situation`
  - `Report evidence`
  - `Gemma decision`
  - `Dispatch`
  - `Resource`
  - `Person`
  - `Alert`

Acceptance checks:

- A keyboard-only user can inspect at least one incident, report, resource, and alert node.
- Screen reader labels identify node type and purpose.

## Phase 9: Playwright Coverage

### New Tests

File:

- `app/tests/graph.spec.js`

Test cases:

1. `renders live-style graph relationships in mock mode`
   - Open `/graph`.
   - Assert Gemma, incidents, reports, dispatches, resources, alerts render.

2. `clicking an incident node opens the relationship sidebar`
   - Click node body, not just button.
   - Assert sidebar opens with summary, reports, dispatch, resource.

3. `clicking a report node opens report evidence`
   - Assert raw text, source device, linked incident.

4. `clicking a dispatch node opens assignment context`
   - Assert rationale, state, incident, resource.

5. `clicking a resource node opens resource relationships`
   - Assert status, capability, linked dispatches.

6. `clicking a person node opens person context`
   - Assert name, status, incident link.

7. `clicking an alert node opens alert context`
   - Assert severity, zone, message, affected incidents.

8. `graph topbar actions still work`
   - Map, alert composer, SITREP, chat, refresh.

9. `graph nodes are keyboard inspectable`
   - Tab to node.
   - Press Enter.
   - Assert inspector opens.

Live smoke:

- Extend `app/tests/live-reports.spec.js` or add `app/tests/live-graph.spec.js`.
- Submit a report through the live fixture hub.
- Open `/graph`.
- Assert report -> incident -> dispatch/resource chain appears.

Acceptance checks:

- `npm run test:e2e` passes.
- `npm run test:e2e:live` passes.
- Manual Playwright smoke against `localhost:5174/graph` can click real nodes without force clicks.

## Suggested Implementation Order

1. Fix React Flow clickability with `onNodeClick` and pointer-event CSS.
2. Add `selectedGraphItem` state and a basic `GraphInspector`.
3. Load reports and persons into `CommandGraph`.
4. Render report and person nodes.
5. Render all dispatch states, not just proposals.
6. Add full relationship edges.
7. Expand inspector details for report/resource/person/alert.
8. Improve layout and legend.
9. Add Playwright graph tests.
10. Re-run manual disaster scenario and verify the graph as the primary interface.

## Definition of Done

The graph is fixed when:

- Every visible node is clickable.
- Clicking any node opens connected context.
- Raw reports, incidents, dispatches, resources, alerts, and persons are all represented.
- The sidebar explains relationships, not just incident details.
- Operators can follow the full chain from field report to Gemma decision to dispatched resource.
- Playwright covers node click behavior and graph relationships.
- Manual graph smoke testing passes without force clicks or selector workarounds.
