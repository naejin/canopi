import { t } from '../../i18n'
import type { MapNoticeReadModel } from '../../app/canvas-map-surface/map-notice'
import styles from '../panels/Panels.module.css'

interface MapNoticeProps {
  readonly notice: MapNoticeReadModel
  readonly onRetry: () => void
}

/** The map's status chip, the same in both editions: a fixed sentence, with Retry when the map or basemap can be rebuilt. */
export function MapNotice({ notice, onRetry }: MapNoticeProps) {
  if (!notice.visible) return null
  return (
    <div className={styles.basemapFeedback} data-tone={notice.tone} role="status" aria-live="polite">
      <span className={styles.basemapFeedbackDot} aria-hidden="true" />
      <span className={styles.basemapFeedbackText}>{notice.statusText}</span>
      {notice.retry && (
        <button type="button" className={styles.basemapFeedbackRetry} onClick={onRetry}>
          {t('canvas.layers.retryMap')}
        </button>
      )}
    </div>
  )
}
