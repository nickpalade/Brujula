// Store-and-forward outbox (PRD §4.1 — offline resilience).
//
// Reports are written to localStorage FIRST (status QUEUED), then a background
// sync loop flushes each to POST /api/reports whenever the hub is reachable.
// Per-report lifecycle:  QUEUED (amber) → SYNCED (green) → PARSED (teal).
//   QUEUED = saved locally, not yet accepted by the hub.
//   SYNCED = hub accepted the report (200), report id assigned.
//   PARSED = hub returned a structured incident (pipeline ran).
// Kill the hub → reports pile up QUEUED; restart it → the loop flushes them.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../shared/api.js'

const STORAGE_KEY = 'brujula.field.outbox.v1'
const SYNC_INTERVAL_MS = 4000

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* quota / private mode — queue stays in memory for this session */
  }
}

function makeLocalId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function useOutbox(sourceDevice, reportedBy = null) {
  const [items, setItems] = useState(load)
  const [online, setOnline] = useState(true)
  const flushing = useRef(false)

  // Persist on every change.
  useEffect(() => {
    save(items)
  }, [items])

  const patch = useCallback((localId, changes) => {
    setItems((prev) =>
      prev.map((it) => (it.localId === localId ? { ...it, ...changes } : it)),
    )
  }, [])

  // Enqueue a new report — saved locally immediately, sent on the next flush.
  const enqueue = useCallback(
    ({ text, category, people_count, location }) => {
      const item = {
        localId: makeLocalId(),
        text,
        category: category || null,
        people_count: people_count ?? null,
        location: location || null,
        source_device: sourceDevice,
        reported_by: reportedBy,
        lang: 'es',
        status: 'QUEUED',
        report_id: null,
        incident_id: null,
        error: null,
        created_at: new Date().toISOString(),
      }
      setItems((prev) => [item, ...prev])
      // Kick a flush right away (fire-and-forget); loop will also retry.
      setTimeout(() => flush(), 0)
      return item.localId
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceDevice, reportedBy],
  )

  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    try {
      // Snapshot pending items (QUEUED or previously ERRORed → retry).
      const pending = load().filter(
        (it) => it.status === 'QUEUED' || it.status === 'ERROR',
      )
      let sawSuccess = false
      let sawFailure = false
      for (const it of pending) {
        try {
          // Compose the raw text the hub/pipeline parses. Category + counts are
          // hints appended so a hand-typed field note still carries structure.
          const parts = [it.text]
          if (it.category) parts.push(`[categoría: ${it.category}]`)
          if (it.people_count != null) parts.push(`[personas: ${it.people_count}]`)
          if (it.location) parts.push(`[ubicación: ${it.location}]`)
          const text = parts.join(' ')

          const data = await api.submitReport({
            text,
            source_device: it.source_device,
            lang: it.lang,
            client_ref: it.localId,
            reported_by: it.reported_by ?? null,
          })
          sawSuccess = true
          const incidentId =
            data?.incident?.id || data?.report?.parsed_into || null
          patch(it.localId, {
            status: incidentId ? 'PARSED' : 'SYNCED',
            report_id: data?.report?.id || null,
            incident_id: incidentId,
            error: null,
          })
        } catch (err) {
          sawFailure = true
          if (err && err.offline) {
            // Hub unreachable — leave QUEUED, try again next tick.
            patch(it.localId, { status: 'QUEUED', error: null })
          } else {
            // Hub rejected the report (validation, etc.) — mark ERROR, retryable.
            patch(it.localId, { status: 'ERROR', error: err.message || 'send failed' })
          }
        }
      }
      // Connectivity heuristic: probe health if nothing to send.
      if (pending.length === 0) {
        try {
          await api.health()
          setOnline(true)
        } catch {
          setOnline(false)
        }
      } else {
        setOnline(sawSuccess || !sawFailure)
      }
    } finally {
      flushing.current = false
    }
  }, [patch])

  // Background sync loop.
  useEffect(() => {
    flush()
    const id = setInterval(flush, SYNC_INTERVAL_MS)
    const onOnline = () => flush()
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', onOnline)
    }
  }, [flush])

  const clearSynced = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status === 'QUEUED' || it.status === 'ERROR'))
  }, [])

  const pendingCount = items.filter((it) => it.status === 'QUEUED' || it.status === 'ERROR').length

  return { items, enqueue, flush, online, clearSynced, pendingCount }
}
