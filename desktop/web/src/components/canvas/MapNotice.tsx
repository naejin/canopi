import { useRef } from 'preact/hooks'
import { t } from '../../i18n'
import type { MapNoticeReadModel } from '../../app/canvas-map-surface/map-notice'
import styles from '../panels/Panels.module.css'

interface MapNoticeProps {
  readonly notice: MapNoticeReadModel
  readonly onRetry: () => void
}

/**
 * The map's status chip, the same in both editions: a fixed sentence, with Retry when the map or basemap can be
 * rebuilt. Only the sentence is the live region. A press on Retry always takes it away (the map shows it loading, or
 * Retry is refused), so focus moves to the chip first instead of falling to the page.
 */
export function MapNotice({ notice, onRetry }: MapNoticeProps) {
  const chip = useRef<HTMLDivElement>(null)
  if (!notice.visible) return null
  const retry = (event: MouseEvent) => {
    if (document.activeElement === event.currentTarget) chip.current?.focus()
    onRetry()
  }
  return (
    <div ref={chip} className={styles.basemapFeedback} data-map-notice="" data-tone={notice.tone} tabIndex={-1}>
      <span className={styles.basemapFeedbackDot} aria-hidden="true" />
      <span className={styles.basemapFeedbackText} role="status" aria-live="polite">{notice.statusText}</span>
      {notice.retry && (
        <button type="button" className={styles.basemapFeedbackRetry} onClick={retry}>
          {t('canvas.layers.retryMap')}
        </button>
      )}
    </div>
  )
}
