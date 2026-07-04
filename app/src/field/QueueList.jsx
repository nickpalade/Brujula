// Outbox view — the visible store-and-forward status per report.
// QUEUED (amber) → SYNCED (green) → PARSED (teal). This is the panel the demo
// points at: kill the hub, submit, watch items sit QUEUED; restart, watch them
// flip to SYNCED/PARSED.

import { useI18n } from '../shared/i18n.jsx'
import PixelCard from '../vendor/PixelCard.jsx'

function timeAgo(t, iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const prefix = t('time.agoPrefix')
  const suffix = t('time.agoSuffix')
  if (s < 60) return `${prefix}${s}s${suffix}`
  const m = Math.floor(s / 60)
  if (m < 60) return `${prefix}${m}m${suffix}`
  return `${prefix}${Math.floor(m / 60)}h${suffix}`
}

function QueueList({ items, onClearSynced }) {
  const { t } = useI18n()

  if (!items || items.length === 0) {
    return (
      <div className="empty">
        {t('q.empty1')}
        <br />
        {t('q.empty2')}
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
        <span className="section-title">{t('q.mine')}</span>
        {hasSynced && (
          <button
            type="button"
            className="chip"
            style={{ minHeight: 32, padding: '6px 12px', fontSize: 13 }}
            onClick={onClearSynced}
          >
            {t('q.clearSynced')}
          </button>
        )}
      </div>

      {items.map((it) => {
        const outgoing = it.status === 'QUEUED' || it.status === 'ERROR'
        const card = (
        <div className={`card${outgoing ? ' card--in-pixel' : ''}`}>
          <div className="card-top">
            {it.category ? (
              <span className="cat-badge">{t(`cat.${it.category}`)}</span>
            ) : (
              <span className="cat-badge">{t('q.noCategory')}</span>
            )}
            <span className={`status-badge st-${it.status}`}>
              {t(`status.${it.status}`)}
            </span>
          </div>
          <div className="card-text">{it.text || (it.has_image ? t('q.photoReport') : '')}</div>
          <div className="card-meta">
            {it.has_image && <span>{t('q.photo')}</span>}
            {it.people_count != null && (
              <span>
                {it.people_count} {t('common.people')}
              </span>
            )}
            {it.location && <span>{it.location}</span>}
            <span>{timeAgo(t, it.created_at)}</span>
            {it.status === 'ERROR' && it.error && (
              <span className="urgency-critical">{it.error}</span>
            )}
          </div>
        </div>
        )
        return outgoing ? (
          <PixelCard key={it.localId} variant="ambar" autoAnimate className="assign-pixel">
            {card}
          </PixelCard>
        ) : (
          <div key={it.localId}>{card}</div>
        )
      })}
    </div>
  )
}

export default QueueList
