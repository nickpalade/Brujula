import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../shared/i18n.jsx'
import Icon from '../shared/Icon.jsx'
import { useFieldStrings } from './fieldStrings.js'

const DISMISSED_KEY = 'brujula.field.alerts.dismissed.v1'
const VIBRATE_PATTERN = [200, 100, 200]

function loadDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

function saveDismissed(set) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

function formatRelativeTime(createdAt) {
  const created = new Date(createdAt)
  const now = new Date()
  const seconds = Math.floor((now - created) / 1000)

  if (seconds < 60) return '< 1 min'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function AlertItem({ alert, onDismiss, severityClass }) {
  const fs = useFieldStrings()

  return (
    <div className={`alert-item ${severityClass}`}>
      <div className="alert-top">
        <span className="alert-severity">{fs(`alert.${alert.severity}`)}</span>
        <button
          type="button"
          className="alert-dismiss-btn"
          onClick={onDismiss}
          aria-label={fs('alert.dismiss')}
          title={fs('alert.dismiss')}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="alert-message">{alert.message}</div>
      <div className="alert-meta">
        {alert.zone && <span className="alert-zone">{alert.zone}</span>}
        <span className="alert-time">{formatRelativeTime(alert.created_at)}</span>
      </div>
    </div>
  )
}

export default function AlertBanner({ alerts }) {
  const [dismissed, setDismissed] = useState(loadDismissed)
  const [seenCritical, setSeenCritical] = useState(new Set())
  const prevAlertsRef = useRef([])

  const handleDismiss = useCallback((alertId) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(alertId)
      saveDismissed(next)
      return next
    })
  }, [])

  useEffect(() => {
    if (!alerts || alerts.length === 0) {
      prevAlertsRef.current = []
      return
    }

    const activeAlerts = alerts.filter((a) => a.active === true && !dismissed.has(a.id))

    activeAlerts.forEach((alert) => {
      const wasSeen = prevAlertsRef.current.some((pa) => pa.id === alert.id)
      if (alert.severity === 'critical' && !wasSeen && !seenCritical.has(alert.id)) {
        try {
          navigator.vibrate?.(VIBRATE_PATTERN)
        } catch {
          /* vibration not supported — continue */
        }
        setSeenCritical((prev) => new Set(prev).add(alert.id))
      }
    })

    prevAlertsRef.current = activeAlerts
  }, [alerts, dismissed, seenCritical])

  if (!alerts || alerts.length === 0) {
    return null
  }

  const visibleAlerts = alerts.filter((a) => a.active === true && !dismissed.has(a.id))

  if (visibleAlerts.length === 0) {
    return null
  }

  return (
    <div className="alert-banner">
      {visibleAlerts.map((alert) => {
        const severityClass = `alert-${alert.severity || 'info'}`
        return (
          <AlertItem
            key={alert.id}
            alert={alert}
            onDismiss={() => handleDismiss(alert.id)}
            severityClass={severityClass}
          />
        )
      })}
    </div>
  )
}
