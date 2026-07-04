// Outbox view — the visible store-and-forward status per report.
// QUEUED (amber) → SYNCED (green) → PARSED (teal). This is the panel the demo
// points at: kill the hub, submit, watch items sit QUEUED; restart, watch them
// flip to SYNCED/PARSED.

const STATUS_LABEL = {
  QUEUED: 'En cola',
  SYNCED: 'Enviado',
  PARSED: 'Procesado',
  ERROR: 'Error',
}

function timeAgo(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `hace ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `hace ${m}m`
  return `hace ${Math.floor(m / 60)}h`
}

function QueueList({ items, onClearSynced }) {
  if (!items || items.length === 0) {
    return (
      <div className="empty">
        No hay reportes todavía.
        <br />
        Los reportes enviados aparecen aquí con su estado de sincronización.
      </div>
    )
  }

  const hasSynced = items.some((it) => it.status === 'SYNCED' || it.status === 'PARSED')

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span className="section-title">Mis reportes</span>
        {hasSynced && (
          <button
            type="button"
            className="chip"
            style={{ minHeight: 32, padding: '6px 12px', fontSize: 13 }}
            onClick={onClearSynced}
          >
            Limpiar enviados
          </button>
        )}
      </div>

      {items.map((it) => (
        <div className="card" key={it.localId}>
          <div className="card-top">
            {it.category ? (
              <span className="cat-badge">{it.category}</span>
            ) : (
              <span className="cat-badge">sin categoría</span>
            )}
            <span className={`status-badge st-${it.status}`}>
              {STATUS_LABEL[it.status] || it.status}
            </span>
          </div>
          <div className="card-text">{it.text}</div>
          <div className="card-meta">
            {it.people_count != null && <span>{it.people_count} personas</span>}
            {it.location && <span>{it.location}</span>}
            <span>{timeAgo(it.created_at)}</span>
            {it.status === 'ERROR' && it.error && (
              <span className="urgency-critical">{it.error}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default QueueList
