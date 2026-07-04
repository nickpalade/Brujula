// Assignment inbox — polls GET /api/sync?since=<seq> every ~4s and keeps a
// merged view of the board (incidents / resources / dispatches).
//
// "Dispatches involving this device" = dispatches whose incident_id belongs to
// an incident THIS phone reported (tracked via the outbox's parsed incident
// ids). If we have no such incidents yet (fresh device), we fall back to
// showing all confirmed dispatches so the single-phone demo still lights up.
//
// Acknowledgement is client-side only (no ack endpoint in CONTRACTS v1): acked
// dispatch ids are persisted in localStorage.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../shared/api.js'

const POLL_MS = 4000
const ACK_KEY = 'brujula.field.acked.v1'

function loadAcked() {
  try {
    return new Set(JSON.parse(localStorage.getItem(ACK_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

function saveAcked(set) {
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

function mergeById(prev, incoming) {
  if (!incoming || incoming.length === 0) return prev
  const map = new Map(prev.map((x) => [x.id, x]))
  for (const x of incoming) map.set(x.id, x)
  return [...map.values()]
}

export function useAssignments(myIncidentIds) {
  const [incidents, setIncidents] = useState([])
  const [resources, setResources] = useState([])
  const [dispatches, setDispatches] = useState([])
  const [alerts, setAlerts] = useState([])
  const [acked, setAcked] = useState(loadAcked)
  const seqRef = useRef(0)

  const poll = useCallback(async () => {
    try {
      const delta = await api.sync(seqRef.current)
      if (typeof delta.seq === 'number') seqRef.current = delta.seq
      setIncidents((p) => mergeById(p, delta.incidents))
      setResources((p) => mergeById(p, delta.resources))
      setDispatches((p) => mergeById(p, delta.dispatches))
      setAlerts((p) => mergeById(p, delta.alerts))
    } catch {
      /* offline — keep last known board, retry next tick */
    }
  }, [])

  useEffect(() => {
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [poll])

  const acknowledge = useCallback((dispatchId) => {
    setAcked((prev) => {
      const next = new Set(prev)
      next.add(dispatchId)
      saveAcked(next)
      return next
    })
  }, [])

  const incidentById = new Map(incidents.map((i) => [i.id, i]))
  const resourceById = new Map(resources.map((r) => [r.id, r]))

  const mine = new Set(myIncidentIds || [])
  let relevant = dispatches.filter((d) => mine.has(d.incident_id))
  if (relevant.length === 0) {
    // Single-phone demo fallback: surface confirmed dispatches.
    relevant = dispatches.filter((d) => d.state === 'confirmed' || d.state === 'done')
  }

  const assignments = relevant
    .map((d) => ({
      ...d,
      incident: incidentById.get(d.incident_id) || null,
      resource: resourceById.get(d.resource_id) || null,
      acknowledged: acked.has(d.id),
    }))
    // Confirmed first, then newest.
    .sort((a, b) => {
      const rank = (s) => (s === 'confirmed' ? 0 : s === 'done' ? 1 : 2)
      return rank(a.state) - rank(b.state)
    })

  const unackedCount = assignments.filter((a) => !a.acknowledged).length

  return { assignments, acknowledge, unackedCount, alerts, board: { incidents, resources, dispatches } }
}
