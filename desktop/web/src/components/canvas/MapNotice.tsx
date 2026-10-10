import type { RefObject } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { t } from '../../i18n'
import type { MapNoticeReadModel } from '../../app/canvas-map-surface/map-notice'
import { phoneLayout } from '../../app/shell/phone-layout'
import { useMapOccluder } from '../shared/useMapChrome'
import styles from '../panels/Panels.module.css'

interface MapNoticeProps {
  readonly notice: MapNoticeReadModel
  readonly onRetry: () => void
  /** The focusable map surface, which takes keyboard focus when the chip goes while holding it. */
  readonly canvasRef: RefObject<HTMLElement>
}

/**
 * The map's status chip, the same in both editions: a fixed sentence, with Retry when the map or basemap can be
 * rebuilt. Only the sentence is the live region. A press on Retry always takes Retry away (the map or basemap shows
 * it loading, or Retry is refused), so focus moves to the chip first instead of falling to the page; when the chip
 * itself goes while holding focus (the map recovered), focus moves to the map. While it shows, its place in the bottom
 * row is bottom chrome on the visible-map-area seam, so the map credits fold into their (i) button instead of sitting
 * under it; the chip shown in that place rises above the row when the zoom group and the view chip leave it too little
 * room (Panels.module.css), and that never moves the framing. On a phone it is placed from the visible map frame
 * itself, so it registers nothing there.
 */
export function MapNotice({ notice, onRetry, canvasRef }: MapNoticeProps) {
  const place = useRef<HTMLDivElement>(null)
  const chip = useRef<HTMLDivElement>(null)
  const handOff = useRef(false)
  useMapOccluder(place, 'bottom', notice.visible && phoneLayout.value === null)
  // Read before the commit removes the chip: afterwards focus has already fallen to the page.
  if (!notice.visible && chip.current?.contains(document.activeElement)) handOff.current = true
  useLayoutEffect(() => {
    if (!handOff.current) return
    handOff.current = false
    canvasRef.current?.focus({ preventScroll: true })
  })
  if (!notice.visible) return null
  const retry = (event: MouseEvent) => {
    if (document.activeElement === event.currentTarget) chip.current?.focus()
    onRetry()
  }
  return (
    <div ref={place} className={styles.basemapFeedback} data-map-notice-place="">
      <div ref={chip} className={styles.basemapFeedbackChip} data-map-notice="" data-tone={notice.tone} tabIndex={-1}>
        <span className={styles.basemapFeedbackDot} aria-hidden="true" />
        <span className={styles.basemapFeedbackText} role="status" aria-live="polite">{notice.statusText}</span>
        {notice.retry && (
          <button type="button" className={styles.basemapFeedbackRetry} onClick={retry}>
            {t('canvas.layers.retryMap')}
          </button>
        )}
      </div>
    </div>
  )
}
