import { useEffect, useRef, useState } from 'react';

// Escalation watchdog: detects unattended incidents (no confirmed/accepted/en_route/on_site dispatch).
// Critical incidents: escalate after 10 min
// High urgency incidents: escalate after 30 min
// Recomputes every 30 seconds so labels age in real time without new sync data.
//
// Returns: { [incidentId]: { escalated: bool, minutes: number, label: string } }

const CRITICAL_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const HIGH_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const WATCHDOG_INTERVAL_MS = 30 * 1000; // 30 seconds

function isUnattended(incident, dispatches) {
  if (incident.status !== 'open') return false;
  const proposal = dispatches.find((d) => d.incident_id === incident.id);
  // Unattended if no dispatch, or dispatch is in proposed/withdrawn state (not confirmed/accepted/en_route/on_site/done)
  if (!proposal) return true;
  const activeStates = new Set(['confirmed', 'accepted', 'en_route', 'on_site', 'done']);
  return !activeStates.has(proposal.state);
}

export function useWatchdog(incidents, dispatches) {
  const [escalated, setEscalated] = useState({});
  const intervalRef = useRef(null);

  const compute = () => {
    const now = Date.now();
    const next = {};
    for (const incident of incidents) {
      if (!isUnattended(incident, dispatches)) continue;
      const age = now - new Date(incident.created_at).getTime();
      const minutes = Math.floor(age / 60000);
      let shouldEscalate = false;
      if (incident.urgency === 'critical' && age > CRITICAL_THRESHOLD_MS) {
        shouldEscalate = true;
      } else if (incident.urgency === 'high' && age > HIGH_THRESHOLD_MS) {
        shouldEscalate = true;
      }
      if (shouldEscalate) {
        next[incident.id] = { escalated: true, minutes, label: `Sin atender · ${minutes} min` };
      }
    }
    setEscalated(next);
  };

  useEffect(() => {
    compute();
    intervalRef.current = setInterval(compute, WATCHDOG_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [incidents, dispatches]);

  return escalated;
}
