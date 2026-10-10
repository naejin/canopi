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
 * itself goes while holding focus (the map recovered), focus moves to the map. While it shows it is bottom chrome on the
 * visible-map-area seam, so the map credits fold into their (i) button instead of sitting under it and the selection
 * chip stands above it; it comes and goes with load state, so it registers with `frames: false` and never moves the
 * camera's framing. On a phone it is placed from the visible map frame itself, so it registers nothing there.
 */
export function MapNotice({ notice, onRetry, canvasRef }: MapNoticeProps) {
  const chip = useRef<HTMLDivElement>(null)
  const handOff = useRef(false)
  useMapOccluder(chip, 'bottom', notice.visible && phoneLayout.value === null, { frames: false })
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
