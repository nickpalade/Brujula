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
// Low-level request: unwraps the {success, data, error} envelope
// ---------------------------------------------------------------------------

async function request(path, { method = 'GET', body, signal } = {}) {
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

  // POST /api/reports  → { report, incident|null }
  // client_ref: idempotency key (the outbox localId) — retries with the same
  // ref replay the stored report instead of duplicating it on the hub.
  async submitReport({ text, source_device = null, lang = 'es', client_ref = null }) {
    if (USE_MOCKS) return mock.submitReport({ text, source_device, lang })
    return request('/api/reports', {
      method: 'POST',
      body: { text, source_device, lang, ...(client_ref ? { client_ref } : {}) },
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

  // GET /api/sync?since=<seq> → { seq, incidents, dispatches, resources }
  async sync(since = 0) {
    if (USE_MOCKS) return mock.sync(since)
    const q = Number.isFinite(since) ? since : 0
    return request(`/api/sync?since=${q}`)
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
}

export default api

// ---------------------------------------------------------------------------
// Named-export aliases — the Command Post (app/src/command/dataSource.js) imports
// these exact names. Field UI uses the `api` object above. Same client, one file.
// ---------------------------------------------------------------------------

export const submitReport = (args) => api.submitReport(args)
export const getIncidents = () => api.getIncidents()
export const getResources = () => api.getResources()
export const getSync = (since) => api.sync(since)
export const getSitrep = () => api.sitrep()
export const advise = (args) => api.advise(args)
export const confirmDispatch = (incidentId, opts) => api.dispatch(incidentId, opts)
export const getReports = (ids) => api.getReports(ids)

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

const mockDB = {
  seq: seedIncidents.length + seedResources.length,
  reports: [],
  incidents: seedIncidents.map((i) => ({ ...i })),
  resources: seedResources.map((r) => ({ ...r })),
  dispatches: [],
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

  sitrep() {
    const open = mockDB.incidents.filter((i) => i.status === 'open')
    const dispatched = mockDB.dispatches.filter((d) => d.state === 'confirmed')
    const text =
      `SITREP (mock) — ${nowISO()}\n` +
      `${open.length} open incidents, ${dispatched.length} confirmed deployments.\n` +
      open.map((i) => `• [${i.urgency.toUpperCase()}] ${i.summary}`).join('\n')
    return delay({ text, generated_at: nowISO() })
  },
}

function stripSeq(obj) {
  const { _seq, ...rest } = obj
  return rest
}
