# Graph Fix — Status

Status of the `GRAPH_NODE_FIX_PLAN.md` work. Last updated: 2026-07-04.

## TL;DR

All 9 plan phases are implemented, the previously unverified working tree has
now been **verified green** on every suite, an adversarial review ran and its
real findings are fixed, and the graph now supports **node dragging, free
pan, and a wider zoom range**. The working tree is ready to commit.

## Verification (this session)

| Suite | Command | Result |
|---|---|---|
| Server unit tests | `npm test` (repo root) | **12/12 pass** |
| Mock e2e | `npx playwright test` (in `app/`) | **22/22 pass** |
| Live e2e | `npm run test:e2e:live` (in `app/`) | **2/2 pass** (port 8021 was free) |
| Lint | `npm run lint` | Clean for graph files; 10 pre-existing warnings elsewhere (`AssignmentInbox`, `LanguagePicker`, `AlertComposer`, `DotGrid`, `i18n`, `AlertBanner`, `useWatchdog`, `IncidentDrawer`) |

Note: the first mock e2e run failed 22/22 with "Executable doesn't exist" —
that was only a missing Playwright browser after an update. Fix:
`npx playwright install chromium` (in `app/`). Not a code problem.

## Plan phases

| Phase | State |
|---|---|
| 1. React Flow clickability (`onNodeClick`, pointer-events CSS, testids) | Done |
| 2. Load reports + persons into the graph | Done |
| 3. All node types (report, person, all dispatch states, resources, alerts) | Done |
| 4. Full relationship edges + color coding | Done |
| 5. `GraphInspector` as relationship sidebar (edit/resolve incident, confirm/override dispatch, deactivate alert, GPS on reports) | Done |
| 6. Layout: section labels, filters (All/Critical/Open/Dispatch/People/Reports), edge legend | Done |
| 7. Data consistency: `parsed_*` fields persisted on reports, cross-kind dedup backstop (`dedupKindsCompatible`), `corrected_by_human` badge | Done + unit tested |
| 8. A11y: keyboard-focusable nodes, Enter/Space inspect, Escape close, focus-to-close-button | Done |
| 9. Playwright coverage (`graph.spec.js` 8 tests + `live-graph.spec.js`) | Done, green |

## Added this session

- **Node dragging** — the graph was fully controlled, so dragged nodes
  snapped back on the next 4-second sync. `CommandGraph` now keeps a
  `nodeOverrides` map fed by `onNodesChange` position changes; overrides are
  re-applied on every repaint, so a hand-arranged layout survives polling.
- **Zoom/pan** — explicit `panOnDrag`, `zoomOnScroll`, `zoomOnPinch`,
  `zoomOnDoubleClick`; zoom range widened from 0.35–1.35 to **0.15–2** so the
  whole board fits on screen when zoomed out.
- **Reset layout** chip (appears in the filter bar once a node has been
  dragged) — clears overrides and re-fits the view. Auto-fit on node-set
  changes is suppressed while a custom layout exists, so sync never fights
  the operator's arrangement.

## Adversarial review (Bugbot) — findings and dispositions

1. **Escape discarded in-progress edit/override** (high) — **fixed**:
   `GraphInspector` now captures Escape while the edit form or override
   picker is open and cancels just that state; the inspector stays open.
2. **Map overlay unreachable by Escape** (medium) — **fixed**: the graph's
   Escape handler now closes the topmost surface (map first, then
   inspector) instead of no-oping while the map is open.
3. **Incident patch errors silent** (medium) — **fixed**: `handleEditSave` /
   `handleResolve` catch failures and render them in the inspector footer
   (`role="alert"`).
4. **Zone-less alerts visible under all filters** (medium) — **intended
   behavior, not changed**: an alert without a zone is a broadcast, so it
   legitimately relates to every visible incident under any filter.

## Remaining / known limitations

- Dragged positions are in-memory only — a page reload restores the
  deterministic column layout. Persisting to `localStorage` is a possible
  follow-up, not planned.
- The 10 lint warnings listed above predate this work and live outside the
  graph files.
- `knowledge-service/data/*.json` protocol files are absent from the working
  tree; the Python matcher runs fallback-only if started as-is (unrelated to
  the graph work, flagged during repo audit).

## Commit readiness

All suites green, review findings addressed. **Safe to commit.** Nothing has
been committed yet — the entire graph fix (plus this session's additions)
sits in the working tree.
