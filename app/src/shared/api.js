// Brújula shared API client — the ONE fetch layer both UIs (/command + /field) use.
// Owned by FIELD-UI. Match context/CONTRACTS.md v1 exactly. Do not fork this file.
//
// Conventions (CONTRACTS §1, §5):
//  - Every hub response is the envelope {success, data, error}. Helpers below
//    UNWRAP it: they resolve to `data` on success, and throw Error(error) on
//    {success:false} or any non-2xx / network failure.
//  - Base URL: import.meta.env.VITE_API_BASE || window.location.origin.
//    In the field, point phones at the hub LAN IP via a Vite env, e.g.
//    VITE_API_BASE=http://192.168.137.1:8000  (laptop hotspot address).
//  - USE_MOCKS (exported const): when true, every call is served from an
//    in-memory board shaped like fixtures/seed_*.json so both UI agents can
//    build before the hub is live. INTEGRATION flips this to false.

// ---------------------------------------------------------------------------
// Flags & config
// ---------------------------------------------------------------------------

// INTEGRATION (2026-07-04): mocks OFF by default — both UIs now talk to the live
// hub. Set VITE_USE_MOCKS=true to force the offline mock layer back on (useful for
// UI-only work without a running server).
export const USE_MOCKS =
  (import.meta.env.VITE_USE_MOCKS ?? 'false') === 'true'

export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000')

// ---------------------------------------------------------------------------
// Agent-activity signal — true while a request that makes the hub THINK is in
// flight (any mutation, or the sitrep — those are the Gemma-backed calls;
// the 4 s sync/health polls don't count). Drives the compass-needle spinner.
// ---------------------------------------------------------------------------

let agentInflight = 0
const busyListeners = new Set()

export function subscribeAgentBusy(fn) {
  busyListeners.add(fn)
  fn(agentInflight > 0)
  return () => busyListeners.delete(fn)
}

function isAgentWork(path, method) {
  return method !== 'GET' || path.startsWith('/api/sitrep')
}

function agentWorkStart() {
  agentInflight += 1
  if (agentInflight === 1) busyListeners.forEach((fn) => fn(true))
}

function agentWorkEnd() {
  agentInflight = Math.max(0, agentInflight - 1)
  if (agentInflight === 0) busyListeners.forEach((fn) => fn(false))
}

// ---------------------------------------------------------------------------
// Low-level request: unwraps the {success, data, error} envelope
// ---------------------------------------------------------------------------

async function request(path, { method = 'GET', body, signal } = {}) {
  const tracked = isAgentWork(path, method)
  if (tracked) agentWorkStart()
  try {
    return await requestInner(path, { method, body, signal })
  } finally {
    if (tracked) agentWorkEnd()
  }
}

async function requestInner(path, { method = 'GET', body, signal } = {}) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (networkErr) {
    // Offline / hub unreachable — the store-and-forward queue depends on this
    // surfacing as a thrown error so reports stay QUEUED.
    const e = new Error('hub unreachable')
    e.cause = networkErr
    e.offline = true
    throw e
  }

  let payload = null
  try {
    payload = await res.json()
  } catch {
    // Non-JSON response (e.g. a proxy error page)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    throw new Error('malformed response (not JSON)')
  }

  // Envelope unwrap
  if (payload && typeof payload === 'object' && 'success' in payload) {
    if (payload.success) return payload.data
    throw new Error(payload.error || `HTTP ${res.status}`)
  }

  // Defensive: a response without the envelope
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return payload
}

// ---------------------------------------------------------------------------
// Public API — one function per CONTRACTS.md endpoint
// ---------------------------------------------------------------------------

export const api = {
  // GET /health — existing server endpoint; used as a reachability probe.
  async health() {
    if (USE_MOCKS) return mock.health()
    return request('/health')
  },

  // POST /api/register — sign this device up as reporter/volunteer/crew.
  // Upsert by device_id (safe to call on every launch). Volunteers/crews also
  // become available resources the agent can propose dispatching.
  async register({ role, name, skill = null, location = null, team_size = null, device_id }) {
    if (USE_MOCKS) return { personnel: { role, name, device_id }, resource: null }
    return request('/api/register', {
      method: 'POST',
      body: { role, name, skill, location, team_size, device_id },
    })
  },

  // POST /api/crew-status — volunteer/crew updates its mission state.
  // idle | traveling | on_site | returning. Engaged crews (traveling/on_site)
  // are excluded from matching; returning crews are re-taskable.
  async setCrewStatus({ device_id, field_status }) {
    if (USE_MOCKS) return { personnel: null, resource: { field_status } }
    return request('/api/crew-status', {
      method: 'POST',
      body: { device_id, field_status },
    })
  },

  // POST /api/reports  → { report, incident|null }
  // client_ref: idempotency key (the outbox localId) — retries with the same
  // ref replay the stored report instead of duplicating it on the hub.
  // reported_by: "Name · rol" from the device profile, stored on the report.
  // image_base64/image_mime: optional photo (pre-compressed by the field app);
  // the hub's parse step reads it multimodally, text may be null when present.
  // lat/lon/accuracy: best-effort phone GPS (additive; omitted when absent).
  async submitReport({
    text,
    source_device = null,
    lang = 'es',
    client_ref = null,
    reported_by = null,
    image_base64 = null,
    image_mime = null,
    lat = null,
    lon = null,
    accuracy = null,
  }) {
    if (USE_MOCKS) return mock.submitReport({ text: text || '(foto)', source_device, lang })
    return request('/api/reports', {
      method: 'POST',
      body: {
        text,
        source_device,
        lang,
        ...(client_ref ? { client_ref } : {}),
        ...(reported_by ? { reported_by } : {}),
        ...(image_base64 ? { image_base64, image_mime: image_mime || 'image/jpeg' } : {}),
        ...(Number.isFinite(lat) && Number.isFinite(lon)
          ? { lat, lon, ...(Number.isFinite(accuracy) ? { accuracy } : {}) }
          : {}),
      },
    })
  },

  // POST /api/transcribe — phone audio clip → laptop local STT → transcript.
  // The phone confirms/edits the returned text before it becomes report text.
  async transcribeVoice({ audio_base64, audio_mime, lang = 'es' }) {
    if (USE_MOCKS) return { text: '(transcripción demo) Necesitamos ayuda médica urgente.', model: 'mock-stt' }
    return request('/api/transcribe', {
      method: 'POST',
      body: { audio_base64, audio_mime, lang },
    })
  },

  // GET /api/incidents → Incident[] (priority-ordered)
  async getIncidents() {
    if (USE_MOCKS) return mock.getIncidents()
    return request('/api/incidents')
  },

  // GET /api/resources → Resource[]
  async getResources() {
    if (USE_MOCKS) return mock.getResources()
    return request('/api/resources')
  },

  // POST /api/incidents/:id/dispatch → updated Dispatch
  //   confirm:  { dispatch_id, action: 'confirm' }
  //   override: { dispatch_id, action: 'override', resource_id }
  async dispatch(incidentId, { dispatch_id, action, resource_id } = {}) {
    if (USE_MOCKS) return mock.dispatch(incidentId, { dispatch_id, action, resource_id })
    const body = { dispatch_id, action }
    if (action === 'override') body.resource_id = resource_id
    return request(`/api/incidents/${encodeURIComponent(incidentId)}/dispatch`, {
      method: 'POST',
      body,
    })
  },

  // POST /api/dispatches/:id/status — field updates dispatch state.
  // state: "accepted"|"en_route"|"on_site"|"done". outcome is optional for done state.
  async setDispatchStatus(dispatchId, { state, outcome = null } = {}) {
    if (USE_MOCKS) return mock.setDispatchStatus(dispatchId, { state, outcome })
    const body = { state }
    if (outcome) body.outcome = outcome
    return request(`/api/dispatches/${encodeURIComponent(dispatchId)}/status`, {
      method: 'POST',
      body,
    })
  },

  // GET /api/sync?since=<seq> → { seq, incidents, dispatches, resources, alerts }
  async sync(since = 0) {
    if (USE_MOCKS) return mock.sync(since)
    const q = Number.isFinite(since) ? since : 0
    return request(`/api/sync?since=${q}`)
  },

  // POST /api/ask → { answer, asked_at } — the field assistant. Grounded Q&A:
  // the hub answers from the live board + offline protocol KB only.
  async ask({ question, device_id = null, lang = 'es' }) {
    if (USE_MOCKS) {
      return {
        answer:
          'Asistente en modo demo: el hub respondería aquí basándose en el tablero y los protocolos.',
        asked_at: new Date().toISOString(),
      }
    }
    return request('/api/ask', {
      method: 'POST',
      body: { question, device_id, lang },
    })
  },

  // POST /api/advise → Advisory { incident_type, steps, source_label, cautions }
  async advise({ incident_type, context = '' }) {
    if (USE_MOCKS) return mock.advise({ incident_type, context })
    return request('/api/advise', {
      method: 'POST',
      body: { incident_type, context },
    })
  },

  // GET /api/sitrep → { text, generated_at }
  async sitrep() {
    if (USE_MOCKS) return mock.sitrep()
    return request('/api/sitrep')
  },

  // GET /api/reports?ids=a,b → Report[] (dedup evidence for the command drawer).
  // Not in CONTRACTS v1; INTEGRATION added the hub endpoint. Degrades to [] when
  // absent so the drawer falls back to the merged-count view.
  async getReports(ids = []) {
    if (USE_MOCKS) return mock.getReports(ids)
    if (!ids || ids.length === 0) return []
    try {
      return await request(`/api/reports?ids=${ids.map(encodeURIComponent).join(',')}`)
    } catch {
      return []
    }
  },

  // GET /language-config → { language, languages: [{code, name}] }
  // The summary/sitrep output language (persisted server-side in
  // brujula_config.json). Controls the language of every model-generated
  // summary and the SITREP.
  async getLanguageConfig() {
    if (USE_MOCKS) return mock.getLanguageConfig()
    return request('/language-config')
  },

  // POST /language-config { language: '<code>' } → { language }
  async setLanguageConfig(language) {
    if (USE_MOCKS) return mock.setLanguageConfig(language)
    return request('/language-config', { method: 'POST', body: { language } })
  },

  // POST /api/alerts { message, severity, zone? } → alert
  // Broadcast alert from the command post (message, severity:info|warning|critical, optional zone)
  async createAlert({ message, severity = 'info', zone = null }) {
    if (USE_MOCKS) return mock.createAlert({ message, severity, zone })
    return request('/api/alerts', {
      method: 'POST',
      body: { message, severity, ...(zone ? { zone } : {}) },
    })
  },

  // POST /api/alerts/:id/deactivate → alert
  // Deactivate an active alert
  async deactivateAlert(id) {
    if (USE_MOCKS) return mock.deactivateAlert(id)
    return request(`/api/alerts/${encodeURIComponent(id)}/deactivate`, { method: 'POST', body: {} })
  },

  // GET /api/alerts → alert[]
  // Fetch all active alerts
  async getAlerts() {
    if (USE_MOCKS) return mock.getAlerts()
    return request('/api/alerts')
  },

  // PATCH /api/incidents/:id { category?, location?, people_count?, urgency?, summary?, status? } → incident
  // Update incident fields (sets corrected_by_human: true)
  async patchIncident(id, patch) {
    if (USE_MOCKS) return mock.patchIncident(id, patch)
    return request(`/api/incidents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    })
  },

  // POST /api/incidents/:id/rematch → { dispatch: Dispatch|null }
  // Re-run matching for an incident; old proposal becomes state "withdrawn"
  async rematchIncident(id) {
    if (USE_MOCKS) return mock.rematchIncident(id)
    return request(`/api/incidents/${encodeURIComponent(id)}/rematch`, {
      method: 'POST',
      body: {},
    })
  },

  // PATCH /api/resources/:id { quantity?, unit?, status? } → resource
  // Update resource inventory (quantity/unit may be int|null and string|null)
  async patchResource(id, patch) {
    if (USE_MOCKS) return mock.patchResource(id, patch)
    return request(`/api/resources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    })
  },

  // GET /api/persons → person[]
  // Fetch missing-persons registry { id, name, status: "missing"|"found"|"safe", detail, incident_id, matched, created_at, updated_at }
  async getPersons() {
    if (USE_MOCKS) return mock.getPersons()
    return request('/api/persons')
  },

  // GET /api/trends?window=120 → { generated_at, window_minutes, categories: [{category, current, previous, delta}], locations: [...] }
  // Fetch trend data over the past window minutes (e.g., 120 = 2h)
  async getTrends(window = 120) {
    if (USE_MOCKS) return mock.getTrends(window)
    return request(`/api/trends?window=${window}`)
  },
}

export default api

// ---------------------------------------------------------------------------
// Named-export aliases — the Command Post (app/src/command/dataSource.js) imports
// these exact names. Field UI uses the `api` object above. Same client, one file.
// ---------------------------------------------------------------------------

export const submitReport = (args) => api.submitReport(args)
export const transcribeVoice = (args) => api.transcribeVoice(args)
export const getIncidents = () => api.getIncidents()
export const getResources = () => api.getResources()
export const getSync = (since) => api.sync(since)
export const getSitrep = () => api.sitrep()
export const advise = (args) => api.advise(args)
export const confirmDispatch = (incidentId, opts) => api.dispatch(incidentId, opts)
export const getReports = (ids) => api.getReports(ids)
export const getLanguageConfig = () => api.getLanguageConfig()
export const setLanguageConfig = (language) => api.setLanguageConfig(language)
export const getAlerts = () => api.getAlerts()
export const createAlert = (args) => api.createAlert(args)
export const deactivateAlert = (id) => api.deactivateAlert(id)
export const patchIncident = (id, patch) => api.patchIncident(id, patch)
export const rematchIncident = (id) => api.rematchIncident(id)
export const patchResource = (id, patch) => api.patchResource(id, patch)
export const getPersons = () => api.getPersons()
export const setDispatchStatus = (dispatchId, opts) => api.setDispatchStatus(dispatchId, opts)
export const getTrends = (window) => api.getTrends(window)

// ===========================================================================
// MOCK LAYER — fixture-shaped, in-memory, stateful.
// Behaves enough like the hub that both UIs (and the store-and-forward queue)
// work end-to-end before the server exists. Shapes mirror fixtures/seed_*.json
// and CONTRACTS §2 exactly. INTEGRATION removes reliance on this by flipping
// USE_MOCKS to false; the file itself stays.
// ===========================================================================

function nowISO() {
  return new Date().toISOString()
}

function rid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

// Seed board — copies of the fixture shapes (kept inline so the mock works
// without importing across the project root, which Vite's fs guard blocks).
const seedIncidents = [
  {
    id: 'inc-seed-collapse-playa-grande',
    kind: 'need',
    category: 'rescue',
    location: 'Playa Grande, Catia La Mar',
    lat: 10.6081,
    lon: -67.0472,
    people_count: 20,
    urgency: 'critical',
    status: 'open',
    summary:
      'Collapsed residential building, voices heard under rubble, ~20 trapped — heavy machinery needed.',
    merged_report_ids: [],
    proposed_dispatch_id: null,
    created_at: '2026-07-04T13:10:00.000Z',
    updated_at: '2026-07-04T13:10:00.000Z',
  },
  {
    id: 'inc-seed-shelter-no-water',
    kind: 'need',
    category: 'water',
    location: 'Refugio Escuela Básica Simón Bolívar, Catia La Mar',
    lat: 10.6019,
    lon: -67.0269,
    people_count: 180,
    urgency: 'high',
    status: 'open',
    summary:
      'Shelter with ~180 people has no drinking water since yesterday; families reporting children drinking untreated water.',
    merged_report_ids: [],
    proposed_dispatch_id: null,
    created_at: '2026-07-04T11:45:00.000Z',
    updated_at: '2026-07-04T11:45:00.000Z',
  },
  {
    id: 'inc-seed-medical-refugio-san-jose',
    kind: 'need',
    category: 'medical',
    location: 'Refugio San José, La Guaira',
    lat: 10.6006,
    lon: -66.9308,
    people_count: 2,
    urgency: 'medium',
    status: 'open',
    summary:
      'Diabetic woman out of insulin for two days and a child with high fever at the shelter; volunteer nurse requesting supplies.',
    merged_report_ids: [],
    proposed_dispatch_id: null,
    created_at: '2026-07-04T10:20:00.000Z',
    updated_at: '2026-07-04T10:20:00.000Z',
  },
]

const seedResources = [
  {
    id: 'res-seed-excavator-caraballeda',
    type: 'machinery',
    label: 'Excavator + 5-person crew (idle)',
    location: 'Caraballeda',
    capacity: '1 excavator, 5-person operating crew',
    status: 'available',
  },
  {
    id: 'res-seed-clinic-catia-la-mar',
    type: 'medical',
    label: 'Improvised clinic with spare capacity',
    location: 'Av. Principal, Catia La Mar',
    capacity: '12 beds free, 2 volunteer doctors on shift',
    status: 'available',
  },
  {
    id: 'res-seed-water-truck-la-guaira',
    type: 'water',
    label: 'Water tanker (cisterna) standing by',
    location: 'Puerto de La Guaira staging area',
    capacity: '10,000 L potable water per trip',
    status: 'available',
  },
]

const URGENCY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

// UI languages the app is translated into (see shared/languages.js).
const MOCK_LANGUAGES = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
]

const mockDB = {
  seq: seedIncidents.length + seedResources.length,
  reports: [],
  incidents: seedIncidents.map((i) => ({ ...i })),
  resources: seedResources.map((r) => ({ ...r })),
  dispatches: [],
  alerts: [],
  persons: [
    {
      id: 'per-1',
      name: 'María G.',
      status: 'missing',
      detail: 'Last seen near Catia La Mar',
      incident_id: 'inc-seed-collapse-playa-grande',
      matched: false,
      created_at: nowISO(),
      updated_at: nowISO(),
    },
    {
      id: 'per-2',
      name: 'Carlos R.',
      status: 'found',
      detail: 'Located at Refugio San José',
      incident_id: 'inc-seed-collapse-playa-grande',
      matched: true,
      created_at: nowISO(),
      updated_at: nowISO(),
    },
  ],
  language: 'es',
}

function bump() {
  return ++mockDB.seq
}

function prioritize(list) {
  return [...list].sort((a, b) => {
    const u = (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9)
    if (u !== 0) return u
    return new Date(a.created_at) - new Date(b.created_at)
  })
}

// Very rough keyword categorizer so mock-parsed reports land in a sensible
// category. The real pipeline (agent PIPELINE) does this with Gemma.
function guessCategory(text) {
  const t = (text || '').toLowerCase()
  if (/(colaps|derrumb|atrapad|rescate|escombro|voces|trapped|rubble|collapse)/.test(t))
    return 'rescue'
  if (/(agua|potable|sed|water|thirst)/.test(t)) return 'water'
  if (/(herid|m[eé]dic|insulina|fiebre|medic|injur|wound|hospital|clinic)/.test(t))
    return 'medical'
  if (/(refugio|shelter|carpa|tienda|techo)/.test(t)) return 'shelter'
  if (/(comida|aliment|hambre|food|hungry)/.test(t)) return 'food'
  if (/(excavad|maquinaria|gr[uú]a|machinery|excavator|crane)/.test(t)) return 'machinery'
  if (/(fuga|gas|incendio|hazard|fire|leak|peligro)/.test(t)) return 'hazard'
  return 'status'
}

function guessUrgency(category, text) {
  const t = (text || '').toLowerCase()
  if (category === 'rescue' || /(voces|atrapad|trapped|cr[ií]tico|urgente|critical)/.test(t))
    return 'critical'
  if (category === 'water' || category === 'medical') return 'high'
  return 'medium'
}

function extractPeople(text) {
  const m = (text || '').match(/(\d{1,4})\s*(personas|people|atrapad|trapped|heridos|injured)/i)
  return m ? parseInt(m[1], 10) : null
}

const MOCK_LATENCY = 350

function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_LATENCY))
}

const mock = {
  health() {
    return delay({ status: 'ok', mock: true })
  },

  submitReport({ text, source_device, lang }) {
    const report = {
      id: rid('rep'),
      raw_text: text,
      source_device: source_device || null,
      lang: lang || null,
      created_at: nowISO(),
      parsed_into: null,
    }
    const category = guessCategory(text)
    const incident = {
      id: rid('inc'),
      kind: category === 'machinery' || category === 'medical' || category === 'water'
        ? 'need'
        : 'need',
      category,
      location: null,
      people_count: extractPeople(text),
      urgency: guessUrgency(category, text),
      status: 'open',
      summary: text.length > 90 ? `${text.slice(0, 87)}…` : text,
      merged_report_ids: [report.id],
      proposed_dispatch_id: null,
      created_at: nowISO(),
      updated_at: nowISO(),
    }
    report.parsed_into = incident.id
    mockDB.reports.push(report)
    mockDB.incidents.push(incident)
    incident._seq = bump()

    // Auto-propose a matching resource for rescue/machinery needs so the
    // command UI + field inbox have something to show in mock mode.
    const need = incident.category
    const match = mockDB.resources.find(
      (r) => r.status === 'available' && (r.type === need || (need === 'rescue' && r.type === 'machinery')),
    )
    if (match) {
      const dsp = {
        id: rid('dsp'),
        incident_id: incident.id,
        resource_id: match.id,
        state: 'proposed',
        rationale: `Nearest available ${match.type} (${match.label}) matches this ${need} need.`,
        proposed_by_ai: true,
        confirmed_by_human_at: null,
      }
      mockDB.dispatches.push(dsp)
      incident.proposed_dispatch_id = dsp.id
      dsp._seq = bump()
    }

    return delay({ report, incident })
  },

  getIncidents() {
    return delay(prioritize(mockDB.incidents).map(stripSeq))
  },

  getResources() {
    return delay(mockDB.resources.map((r) => ({ ...r })))
  },

  dispatch(incidentId, { dispatch_id, action, resource_id }) {
    const dsp = mockDB.dispatches.find((d) => d.id === dispatch_id)
    if (!dsp) return Promise.reject(new Error('unknown dispatch'))
    if (dsp.state !== 'proposed') return Promise.reject(new Error('dispatch not in proposed state'))
    const incident = mockDB.incidents.find((i) => i.id === incidentId)
    if (action === 'override' && resource_id) {
      dsp.resource_id = resource_id
      dsp.proposed_by_ai = false
    }
    dsp.state = 'confirmed'
    dsp.confirmed_by_human_at = nowISO()
    const resource = mockDB.resources.find((r) => r.id === dsp.resource_id)
    if (resource) resource.status = 'committed'
    if (incident) {
      incident.status = 'dispatched'
      incident.updated_at = nowISO()
      incident._seq = bump()
    }
    dsp._seq = bump()
    return delay(stripSeq(dsp))
  },

  sync(since = 0) {
    const changed = (arr) => arr.filter((x) => (x._seq || 0) > since).map(stripSeq)
    return delay({
      seq: mockDB.seq,
      incidents: changed(mockDB.incidents),
      dispatches: changed(mockDB.dispatches),
      resources: changed(mockDB.resources),
      alerts: mockDB.alerts ? changed(mockDB.alerts) : [],
      persons: (mockDB.persons || []).map(stripSeq),
    })
  },

  advise({ incident_type }) {
    const table = {
      rescue: {
        steps: [
          'Enforce silence periods to listen for live victims',
          'Shore unstable structure before any entry',
          'Triage extricated casualties using START',
        ],
        source_label: 'INSARAG/USAR field guidance (representative)',
      },
      water: {
        steps: [
          'Provide at least 15 L/person/day (Sphere minimum)',
          'Chlorinate to a measurable free residual before distribution',
          'Site latrines ≥30 m from water sources',
        ],
        source_label: 'Sphere / WASH standards (representative)',
      },
      medical: {
        steps: [
          'Triage arrivals by acuity (START)',
          'Prioritize measles vaccination in crowded shelters (PAHO/WHO)',
          'Isolate suspected communicable cases',
        ],
        source_label: 'PAHO/WHO field guidance (representative)',
      },
    }
    const hit = table[incident_type]
    return delay({
      incident_type,
      steps: hit ? hit.steps : ['Assess scene safety', 'Report situation to command', 'Await tasking'],
      source_label: hit ? hit.source_label : 'General field safety (representative)',
      cautions: ['Operational guidance for trained responders — not medical advice'],
    })
  },

  getReports() {
    // Mock board keeps no per-report bodies; drawer degrades to merged count.
    return delay([])
  },

  getLanguageConfig() {
    return delay({ language: mockDB.language, languages: MOCK_LANGUAGES })
  },

  setLanguageConfig(language) {
    if (!MOCK_LANGUAGES.some((l) => l.code === language)) {
      return Promise.reject(new Error(`unsupported language: ${language}`))
    }
    mockDB.language = language
    return delay({ language })
  },

  sitrep() {
    const open = mockDB.incidents.filter((i) => i.status === 'open')
    const dispatched = mockDB.dispatches.filter((d) => d.state === 'confirmed')
    const text =
      `SITREP (mock) — ${nowISO()}\n` +
      `${open.length} open incidents, ${dispatched.length} confirmed deployments.\n` +
      open.map((i) => `• [${i.urgency.toUpperCase()}] ${i.summary}`).join('\n')
    return delay({ text, generated_at: nowISO() })
  },

  createAlert({ message, severity, zone }) {
    const alert = {
      id: rid('alrt'),
      message,
      severity: severity || 'info',
      zone: zone || null,
      active: true,
      created_at: nowISO(),
    }
    mockDB.alerts = mockDB.alerts || []
    mockDB.alerts.push(alert)
    return delay(alert)
  },

  deactivateAlert(id) {
    const alerts = mockDB.alerts || []
    const alert = alerts.find((a) => a.id === id)
    if (alert) alert.active = false
    return delay(alert || { id, active: false })
  },

  getAlerts() {
    return delay((mockDB.alerts || []).filter((a) => a.active))
  },

  patchIncident(id, patch) {
    const incident = mockDB.incidents.find((i) => i.id === id)
    if (!incident) return Promise.reject(new Error('incident not found'))
    const updated = { ...incident, ...patch, corrected_by_human: true, updated_at: nowISO() }
    Object.assign(incident, updated)
    incident._seq = bump()
    return delay(stripSeq(incident))
  },

  rematchIncident(id) {
    // Mark old proposal as withdrawn, propose a new one (or null)
    const incident = mockDB.incidents.find((i) => i.id === id)
    if (!incident) return Promise.reject(new Error('incident not found'))
    const oldDispatch = mockDB.dispatches.find((d) => d.id === incident.proposed_dispatch_id)
    if (oldDispatch) oldDispatch.state = 'withdrawn'
    // Simple mock: pick a random available resource if any
    const match = mockDB.resources.find((r) => r.status === 'available')
    let newDispatch = null
    if (match) {
      newDispatch = {
        id: rid('dsp'),
        incident_id: id,
        resource_id: match.id,
        state: 'proposed',
        rationale: `Re-matched: ${match.label}`,
        proposed_by_ai: true,
        confirmed_by_human_at: null,
      }
      mockDB.dispatches.push(newDispatch)
      incident.proposed_dispatch_id = newDispatch.id
      newDispatch._seq = bump()
    }
    incident._seq = bump()
    return delay({ dispatch: newDispatch ? stripSeq(newDispatch) : null })
  },

  patchResource(id, patch) {
    const resource = mockDB.resources.find((r) => r.id === id)
    if (!resource) return Promise.reject(new Error('resource not found'))
    Object.assign(resource, patch)
    resource._seq = bump()
    return delay(stripSeq(resource))
  },

  getPersons() {
    // Mock persons list
    return delay([
      {
        id: 'per-1',
        name: 'María G.',
        status: 'missing',
        detail: 'Last seen near Catia La Mar',
        incident_id: 'inc-seed-collapse-playa-grande',
        matched: false,
        created_at: nowISO(),
        updated_at: nowISO(),
      },
      {
        id: 'per-2',
        name: 'Carlos R.',
        status: 'found',
        detail: 'Located at Refugio San José',
        incident_id: 'inc-seed-collapse-playa-grande',
        matched: true,
        created_at: nowISO(),
        updated_at: nowISO(),
      },
    ])
  },

  setDispatchStatus(dispatchId, { state, outcome }) {
    const dispatch = mockDB.dispatches.find((d) => d.id === dispatchId)
    if (!dispatch) return Promise.reject(new Error('dispatch not found'))
    dispatch.state = state
    if (outcome) dispatch.outcome = outcome
    dispatch.status_updated_at = nowISO()
    dispatch._seq = bump()
    const resource = mockDB.resources.find((r) => r.id === dispatch.resource_id)
    const incident = mockDB.incidents.find((i) => i.id === dispatch.incident_id)
    if (incident) incident._seq = bump()
    return delay({
      dispatch: stripSeq(dispatch),
      resource: resource ? stripSeq(resource) : null,
      incident: incident ? stripSeq(incident) : null,
    })
  },

  getTrends(window) {
    return delay({
      generated_at: nowISO(),
      window_minutes: window,
      categories: [
        { category: 'rescue', current: 3, previous: 2, delta: 1 },
        { category: 'water', current: 2, previous: 3, delta: -1 },
        { category: 'medical', current: 4, previous: 4, delta: 0 },
      ],
      locations: [
        { location: 'Catia La Mar', current: 5, previous: 4, delta: 1 },
        { location: 'La Guaira', current: 3, previous: 2, delta: 1 },
      ],
    })
  },
}

function stripSeq(obj) {
  const { _seq, ...rest } = obj
  return rest
}
