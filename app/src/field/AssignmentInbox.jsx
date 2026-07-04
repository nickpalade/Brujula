// Assignment inbox — dispatches from the Command Post involving this device.
// Each shows the AI/coordinator's tasking (resource → incident + rationale) and
// an acknowledge tap so command knows the responder received it.
// Unacknowledged taskings shimmer in (garnet pixel field) to pull the eye:
// something INCOMING that still needs a confirmation tap.

import PixelCard from '../vendor/PixelCard.jsx'

function AssignmentInbox({ assignments, onAcknowledge }) {
  if (!assignments || assignments.length === 0) {
    return (
      <div className="empty">
        No hay asignaciones.
        <br />
        Cuando el Puesto de Mando te despache un recurso, aparecerá aquí.
      </div>
    )
  }

  return (
    <div>
      <span className="section-title">Asignaciones</span>
      {assignments.map((a) => {
        const incident = a.incident
        const resource = a.resource
        const urgency = incident?.urgency
        const card = (
          <div className={`card${a.acknowledged ? '' : ' card--in-pixel'}`}>
            <div className="card-top">
              <span className="cat-badge">
                {incident?.category || 'asignación'}
              </span>
              {urgency && (
                <span className={`status-badge urgency-${urgency}`}>
                  {urgency.toUpperCase()}
                </span>
              )}
            </div>

            <div className="assign-title">
              {resource ? resource.label : a.resource_id}
            </div>
            <div className="card-text">
              → {incident?.summary || incident?.location || a.incident_id}
            </div>

            {a.rationale && <div className="assign-rationale">{a.rationale}</div>}

            <div className="card-meta">
              {incident?.location && <span>{incident.location}</span>}
              {resource?.location && <span>Desde: {resource.location}</span>}
              <span>Estado: {a.state}</span>
            </div>

            <button
              type="button"
              className={`ack-btn${a.acknowledged ? ' acked' : ''}`}
              onClick={() => !a.acknowledged && onAcknowledge(a.id)}
              disabled={a.acknowledged}
            >
              {a.acknowledged ? 'Confirmado ✓' : 'Confirmar recepción'}
            </button>
          </div>
        )
        return a.acknowledged ? (
          <div key={a.id}>{card}</div>
        ) : (
          <PixelCard key={a.id} variant="granate" autoAnimate className="assign-pixel">
            {card}
          </PixelCard>
        )
      })}
    </div>
  )
}

export default AssignmentInbox
