// Brújula — Field client (PRD §5C, mobile-first, route /field).
// A responder in the field: submit reports (store-and-forward), receive
// assignments. Two thumb-reachable tabs. Uses the shared api.js client.

import { useMemo, useState } from 'react'
import './field.css'
import { USE_MOCKS } from '../shared/api.js'
import { useOutbox } from './useOutbox.js'
import { useAssignments } from './useAssignments.js'
import ReportForm from './ReportForm.jsx'
import QueueList from './QueueList.jsx'
import AssignmentInbox from './AssignmentInbox.jsx'

const DEVICE_KEY = 'brujula.field.device.v1'

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = 'field-phone-1'
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'field-phone-1'
  }
}

function ConnPill({ online }) {
  return (
    <span className={`conn-pill ${online ? 'conn-online' : 'conn-offline'}`}>
      <span className="dot" />
      {online ? 'Hub conectado' : 'Sin conexión'}
    </span>
  )
}

function FieldClient() {
  const deviceId = useMemo(getDeviceId, [])
  const [tab, setTab] = useState('report')
  const [toast, setToast] = useState(null)

  const { items, enqueue, online, clearSynced } = useOutbox(deviceId)

  const myIncidentIds = useMemo(
    () => items.map((it) => it.incident_id).filter(Boolean),
    [items],
  )
  const { assignments, acknowledge, unackedCount } = useAssignments(myIncidentIds)

  const handleSubmit = (report) => {
    enqueue(report)
    setToast('Reporte guardado — se enviará al hub')
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <div className="field-app">
      <header className="field-header">
        <div>
          <h1>Brújula · Campo</h1>
          <div className="field-sub">
            {deviceId}
            {USE_MOCKS ? ' · modo demo' : ''}
          </div>
        </div>
        <ConnPill online={online} />
      </header>

      <main className="field-body">
        {tab === 'report' ? (
          <>
            <ReportForm onSubmit={handleSubmit} />
            <div style={{ marginTop: 28 }}>
              <QueueList items={items} onClearSynced={clearSynced} />
            </div>
          </>
        ) : (
          <AssignmentInbox assignments={assignments} onAcknowledge={acknowledge} />
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}

      <nav className="field-tabs">
        <button
          type="button"
          className={`field-tab${tab === 'report' ? ' active' : ''}`}
          onClick={() => setTab('report')}
        >
          Reportar
        </button>
        <button
          type="button"
          className={`field-tab${tab === 'inbox' ? ' active' : ''}`}
          onClick={() => setTab('inbox')}
        >
          Asignaciones
          {unackedCount > 0 && <span className="badge-count">{unackedCount}</span>}
        </button>
      </nav>
    </div>
  )
}

export default FieldClient
