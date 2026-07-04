/*
 * Local mock backend for the Command Post — stands in for the shared
 * api.js (FIELD-UI owns app/src/shared/api.js; not wired yet) and the live
 * hub. Shapes match CONTRACTS.md §2/§3 EXACTLY so INTEGRATION's swap is
 * mechanical: point command/dataSource.js at ../shared/api.js instead.
 *
 * It is deliberately stateful (confirm/override mutate the board, seq bumps
 * on every write) so the demo's CONFIRM moment works fully offline in mocks.
 */

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const MIN = 60_000;
const HR = 60 * MIN;

let seq = 20;
const bump = () => ++seq;
let idc = 100;
const rid = (p) => `${p}_${(idc++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* --- Seeded board (fixtures/seed_*.json shapes, enriched for the demo) --- */
const incidents = [
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
    // Dedup evidence: two differently-worded reports merged into one incident.
    merged_report_ids: ['rep-seed-pg-1', 'rep-seed-pg-2'],
    proposed_dispatch_id: 'dsp-seed-1',
    created_at: iso(8 * MIN),
    updated_at: iso(2 * MIN),
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
    merged_report_ids: ['rep-seed-water-1'],
    proposed_dispatch_id: 'dsp-seed-2',
    created_at: iso(3 * HR),
    updated_at: iso(3 * HR),
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
    merged_report_ids: ['rep-seed-med-1'],
    proposed_dispatch_id: null,
    created_at: iso(5 * HR),
    updated_at: iso(5 * HR),
  },
];

const resources = [
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
];

const dispatches = [
  {
    id: 'dsp-seed-1',
    incident_id: 'inc-seed-collapse-playa-grande',
    resource_id: 'res-seed-excavator-caraballeda',
    state: 'proposed',
    rationale:
      'Idle excavator crew in Caraballeda (~3 km) is the nearest heavy machinery; collapse has live victims and needs extrication capacity now.',
    proposed_by_ai: true,
    confirmed_by_human_at: null,
  },
  {
    id: 'dsp-seed-2',
    incident_id: 'inc-seed-shelter-no-water',
    resource_id: 'res-seed-water-truck-la-guaira',
    state: 'proposed',
    rationale:
      'Water tanker at La Guaira staging (10,000 L) covers the 180-person shelter above Sphere minimums; nearest potable-water asset available.',
    proposed_by_ai: true,
    confirmed_by_human_at: null,
  },
];

/*
 * Reports keyed by id — powers the drawer's "merged report texts" dedup
 * evidence. NOTE: CONTRACTS v1 has no GET /reports endpoint, so the drawer
 * degrades to merged_report_ids.length when texts aren't available. This mock
 * exposes getReports() as a convenience; see inbox note 001-to-FIELD-UI.
 */
const reports = {
  'rep-seed-pg-1': {
    id: 'rep-seed-pg-1',
    raw_text:
      'Edificio colapsado en Playa Grande, Catia La Mar. Escuchamos voces, unas 20 personas atrapadas. Necesitamos maquinaria pesada.',
    source_device: 'field-phone-1',
    lang: 'es',
    created_at: iso(8 * MIN),
    parsed_into: 'inc-seed-collapse-playa-grande',
  },
  'rep-seed-pg-2': {
    id: 'rep-seed-pg-2',
    raw_text:
      'Un bloque de apartamentos se vino abajo cerca de la playa en Catia La Mar. Hay gente debajo de los escombros, se oyen gritos. Hace falta una excavadora urgente.',
    source_device: 'field-phone-3',
    lang: 'es',
    created_at: iso(4 * MIN),
    parsed_into: 'inc-seed-collapse-playa-grande',
  },
  'rep-seed-water-1': {
    id: 'rep-seed-water-1',
    raw_text:
      'En el refugio de la Escuela Simón Bolívar no hay agua potable desde ayer. Somos como 180 personas, hay niños tomando agua sucia.',
    source_device: 'field-phone-2',
    lang: 'es',
    created_at: iso(3 * HR),
    parsed_into: 'inc-seed-shelter-no-water',
  },
  'rep-seed-med-1': {
    id: 'rep-seed-med-1',
    raw_text:
      'Refugio San José: una señora diabética lleva dos días sin insulina y hay un niño con fiebre alta. Enfermera voluntaria pide insumos.',
    source_device: 'field-phone-2',
    lang: 'es',
    created_at: iso(5 * HR),
    parsed_into: 'inc-seed-medical-refugio-san-jose',
  },
};

/* --- Protocol advisories (mirrors KB-MOCK Advisory shape, CONTRACTS §3) --- */
const ADVISORIES = {
  rescue: {
    incident_type: 'rescue',
    steps: [
      'Enforce silence periods so teams can listen for live victims.',
      'Shore and stabilize the structure before any entry.',
      'Establish a single point of entry and a safety officer.',
      'Triage extricated casualties with START before transport.',
    ],
    source_label: 'INSARAG/USAR field guidance (representative)',
    cautions: [
      'Operational guidance for trained USAR responders — not medical advice.',
      'Do not enter unshored voids; secondary collapse risk after aftershocks.',
    ],
  },
  water: {
    incident_type: 'water',
    steps: [
      'Target at least 15 L per person per day (Sphere minimum).',
      'Chlorinate to a free residual of 0.2–0.5 mg/L at the point of use.',
      'Separate drinking-water points from latrines by ≥30 m and downhill.',
      'Label treated vs untreated containers to prevent cross-use.',
    ],
    source_label: 'Sphere WASH standards (representative)',
    cautions: [
      'Operational guidance for trained responders — not medical advice.',
    ],
  },
  medical: {
    incident_type: 'medical',
    steps: [
      'Register and prioritize casualties using START triage.',
      'Route to the nearest facility with matching capacity.',
      'Track chronic-care needs (insulin, dialysis) as time-critical logistics.',
    ],
    source_label: 'Mass-casualty triage guidance (representative)',
    cautions: [
      'Operational coordination for trained responders — not patient diagnosis or treatment advice.',
    ],
  },
  shelter: {
    incident_type: 'shelter',
    steps: [
      'Watch crowding; measles/cholera risk rises in dense shelters (PAHO/WHO).',
      'Prioritize vaccination coverage and clean-water access.',
      'Set up separation/isolation space for suspected cases.',
    ],
    source_label: 'PAHO/WHO shelter guidance (representative)',
    cautions: [
      'Operational public-health coordination — not individual medical advice.',
    ],
  },
};

const genericAdvisory = (type) => ({
  incident_type: type ?? 'status',
  steps: [
    'Confirm scene safety and account for responders before acting.',
    'Report structured status back to the command post.',
    'Await matched resource and confirmed dispatch before committing.',
  ],
  source_label: 'General field-safety guidance (representative)',
  cautions: ['Operational guidance for trained responders — not medical advice.'],
});

/* --------------------------- API surface --------------------------- */
// Signatures FIELD-UI's shared/api.js should match (see inbox 001).

const clone = (x) => JSON.parse(JSON.stringify(x));
const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));

export async function getSync(/* since */) {
  await delay(180);
  return { seq, incidents: clone(incidents), dispatches: clone(dispatches), resources: clone(resources) };
}

export async function getIncidents() {
  await delay(180);
  return clone(incidents);
}

export async function getResources() {
  await delay(120);
  return clone(resources);
}

export async function getSitrep() {
  await delay(500); // model-ish latency so the UI's loading state is visible
  const open = incidents.filter((i) => i.status === 'open');
  const dispatched = incidents.filter((i) => i.status === 'dispatched');
  const confirmed = dispatches.filter((d) => d.state === 'confirmed' || d.state === 'done');
  const lines = [];
  lines.push('SITREP — Command Post, La Guaira corridor');
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`OPEN INCIDENTS (${open.length}):`);
  for (const i of open) {
    lines.push(`  • [${i.urgency.toUpperCase()}] ${i.category} — ${i.location} (~${i.people_count ?? '?'} affected): ${i.summary}`);
  }
  lines.push('');
  lines.push(`CONFIRMED DEPLOYMENTS (${confirmed.length}):`);
  if (confirmed.length === 0) lines.push('  • None confirmed yet.');
  for (const d of confirmed) {
    const inc = incidents.find((i) => i.id === d.incident_id);
    const res = resources.find((r) => r.id === d.resource_id);
    lines.push(`  • ${res?.label ?? d.resource_id} → ${inc?.location ?? d.incident_id}`);
  }
  lines.push('');
  lines.push(`UNMET NEEDS: ${dispatched.length} incident(s) resourced, ${open.length} still awaiting dispatch.`);
  return { text: lines.join('\n'), generated_at: new Date().toISOString() };
}

export async function advise({ incident_type, context } = {}) {
  await delay(450);
  void context;
  return clone(ADVISORIES[incident_type] ?? genericAdvisory(incident_type));
}

export async function submitReport({ text, source_device = 'command-post', lang = 'es' } = {}) {
  await delay(600);
  const report = {
    id: rid('rep'),
    raw_text: text,
    source_device,
    lang,
    created_at: new Date().toISOString(),
    parsed_into: null,
  };
  reports[report.id] = report;
  bump();
  return { report, incident: null };
}

export async function confirmDispatch(incidentId, { dispatch_id, action, resource_id } = {}) {
  await delay(400);
  const dsp = dispatches.find((d) => d.id === dispatch_id && d.incident_id === incidentId);
  if (!dsp) throw new Error('Dispatch not found');
  if (dsp.state !== 'proposed') throw new Error('Dispatch already resolved');

  if (action === 'override' && resource_id) {
    dsp.resource_id = resource_id;
    dsp.proposed_by_ai = false;
    dsp.rationale = `Coordinator override — resource reassigned by command.`;
  }
  dsp.state = 'confirmed';
  dsp.confirmed_by_human_at = new Date().toISOString();

  const inc = incidents.find((i) => i.id === incidentId);
  if (inc) {
    inc.status = 'dispatched';
    inc.updated_at = new Date().toISOString();
  }
  const res = resources.find((r) => r.id === dsp.resource_id);
  if (res) res.status = 'committed';
  bump();
  return clone(dsp);
}

/* Convenience (not in CONTRACTS v1) — drawer dedup evidence. */
export async function getReports(ids = []) {
  await delay(120);
  return ids.map((id) => reports[id]).filter(Boolean).map(clone);
}

/* UI languages the app is translated into (see shared/languages.js). */
const MOCK_LANGUAGES = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
];

let mockLanguage = 'es';

export async function getLanguageConfig() {
  await delay(120);
  return { language: mockLanguage, languages: clone(MOCK_LANGUAGES) };
}

export async function setLanguageConfig(language) {
  await delay(120);
  if (!MOCK_LANGUAGES.some((l) => l.code === language)) {
    throw new Error(`unsupported language: ${language}`);
  }
  mockLanguage = language;
  return { language };
}
