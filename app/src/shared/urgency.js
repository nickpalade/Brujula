/*
 * Urgency + formatting helpers shared by /command and /field.
 * Urgency vocabulary is fixed by CONTRACTS.md §2:
 *   "critical" | "high" | "medium" | "low"  (live victims -> critical)
 */

export const URGENCY_ORDER = ['critical', 'high', 'medium', 'low'];

const URGENCY_RANK = URGENCY_ORDER.reduce((acc, u, i) => {
  acc[u] = i;
  return acc;
}, {});

export const URGENCY_LABEL = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

export const CATEGORY_LABEL = {
  rescue: 'Rescue',
  medical: 'Medical',
  water: 'Water',
  shelter: 'Shelter',
  food: 'Food',
  machinery: 'Machinery',
  hazard: 'Hazard',
  status: 'Status',
};

/** A live-victim rescue is the thing that must scream at the top. */
export function isLiveVictim(incident) {
  return incident?.category === 'rescue' && incident?.urgency === 'critical';
}

/**
 * Sort incidents by urgency (critical first), then by age (oldest first —
 * a critical need waiting longest rises). Mirrors the pipeline `prioritize`
 * intent so the board looks right even before INTEGRATION wires the hub.
 */
export function sortByPriority(incidents = []) {
  return [...incidents].sort((a, b) => {
    const ra = URGENCY_RANK[a.urgency] ?? 99;
    const rb = URGENCY_RANK[b.urgency] ?? 99;
    if (ra !== rb) return ra - rb;
    // Live-victim rescue wins ties within the same urgency band.
    const la = isLiveVictim(a) ? 0 : 1;
    const lb = isLiveVictim(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

/** Compact human age, e.g. "12m", "3h", "2d". */
export function formatAge(iso, now = Date.now()) {
  if (!iso) return '—';
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}
