# Brújula — React app (`/app`)

The one React app serving both UIs, routed by path:

- **`/command`** — Command Post (laptop, the coordinator's screen): prioritized
  incident feed, AI dispatch proposals with confirm/override, resource
  inventory, incident drawer (dedup evidence + protocol advisory), SITREP.
- **`/field`** — Field client (phones, installable PWA): role signup on first
  open (reporter / volunteer / specialized crew), report form with voice input
  and 📷 photo attach, store-and-forward outbox, crew mission status,
  assignment inbox.

Everything talks to the hub through **one fetch layer**:
[`src/shared/api.js`](src/shared/api.js) — the `/api/*` endpoints only, every
response unwrapped from the `{success, data, error}` envelope. Don't fork it;
both UIs import it.

## Build (what the demo uses)

```bash
npm install
npm run build        # → app/dist
```

The Express hub serves `app/dist` at `/command` and `/field` — there is no
separate frontend server in the field. **After any UI change, rebuild**; the
hub serves the built files, not the dev server.

## Dev workflow

```bash
npm run dev          # Vite dev server with HMR
npm run lint         # oxlint
```

Two env flags (Vite, so set at dev/build time):

| Flag | Default | Effect |
|---|---|---|
| `VITE_USE_MOCKS` | `false` | `true` = serve every API call from the in-memory mock board in `api.js` — UI work with no hub running |
| `VITE_API_BASE` | `window.location.origin` | point a dev build at a remote hub, e.g. `http://192.168.137.1:8000` |

## Layout

```
src/
  shared/api.js      the ONE hub client (+ mock layer) — both UIs use it
  command/           Command Post: board, proposals, drawer, sitrep
  field/
    FieldClient.jsx  shell: profile, tabs, registration retry, status bar
    Onboarding.jsx   first-open role signup (POST /api/register)
    ReportForm.jsx   text + voice + photo report composer
    photo.js         on-device photo downscale/compress (fits localStorage)
    useOutbox.js     store-and-forward queue: QUEUED → SYNCED → PARSED
    QueueList.jsx    per-report sync status ("Mis reportes")
    AssignmentInbox.jsx / useAssignments.js   dispatches for this device
    voice/           es-VE speech recognition input
    field.css        field tokens + styles (mobile-first, thumb-reachable)
```

## Conventions

- **Offline is a constraint:** no webfonts, no CDN, no external assets —
  everything ships in the bundle.
- **Reports save locally first** (localStorage outbox), then flush with an
  idempotent `client_ref` — killing the hub mid-demo loses nothing.
- Photos are compressed on-device (`photo.js`, max edge 1280 px JPEG) before
  they enter the outbox; the base64 is dropped from localStorage once synced.
- The PWA installs via Add to Home Screen (manifest + icons from
  `design/`); iOS safe-areas are handled in `field.css`.
