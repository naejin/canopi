import type { RefObject } from 'preact'
import { signal } from '@preact/signals'
import { useCallback, useLayoutEffect, useRef } from 'preact/hooks'
import { t } from '../../i18n'
import type { MapNoticeReadModel } from '../../app/canvas-map-surface/map-notice'
import { storyPresentationActive } from '../../app/story-presentation'
import { useMapOccluder } from '../shared/useMapChrome'
import styles from '../panels/Panels.module.css'

interface MapNoticeProps {
  readonly notice: MapNoticeReadModel
  readonly onRetry: () => void
  /** The focusable map surface, which takes keyboard focus when the chip goes while holding it. */
  readonly canvasRef: RefObject<HTMLElement>
}

/** The canvas's notice and its map's Retry while a story is presented, for the presenter to draw. */
const presentedNotice = signal<{ readonly notice: MapNoticeReadModel, readonly onRetry: () => void } | null>(null)

/**
 * The map's status chip, the same in both editions: a fixed sentence, with Retry when the map or basemap can be
 * rebuilt. Only the sentence is the live region. While a story is presented the canvas draws no chip: the full-window
 * presenter is modal over the map, so it draws this notice itself, with the same Retry, inside its own layer and Tab
 * cycle (`PresentedMapNotice`). The chip stands above the bottom row, so it takes none of the map credits' room. While
 * it shows on the canvas it is bottom chrome on the visible-map-area seam only so the selection chip stands above it,
 * phones included; it comes and goes with load state, so it registers with `frames: false` and never moves the
 * camera's framing.
 */
export function MapNotice({ notice, onRetry, canvasRef }: MapNoticeProps) {
  const presenting = storyPresentationActive.value
  const latestRetry = useRef(onRetry)
  latestRetry.current = onRetry
  const retry = useCallback(() => latestRetry.current(), [])
  const { visible, tone, statusText, retry: offersRetry } = notice
  useLayoutEffect(() => {
    if (presenting) presentedNotice.value = { notice, onRetry: retry }
  }, [presenting, visible, tone, statusText, offersRetry])
  useLayoutEffect(() => {
    if (presenting) return () => { presentedNotice.value = null }
  }, [presenting])
  return <NoticeChip notice={notice} shown={visible && !presenting} onRetry={onRetry} focusHome={canvasRef} onMap />
}

/** The canvas's map notice inside the story presenter, which takes focus when the chip goes while holding it. */
export function PresentedMapNotice({ focusHome }: { readonly focusHome: RefObject<HTMLElement> }) {
  const presented = presentedNotice.value
  const notice = presented?.notice ?? HIDDEN
  return <NoticeChip notice={notice} shown={notice.visible} onRetry={presented?.onRetry ?? noRetry} focusHome={focusHome} onMap={false} />
}

const HIDDEN: MapNoticeReadModel = { visible: false, mapSurfaceVisible: false, tone: 'ready', statusText: '', retry: false }
const noRetry = () => {}

interface NoticeChipProps {
  readonly notice: MapNoticeReadModel
  readonly shown: boolean
  readonly onRetry: () => void
  readonly focusHome: RefObject<HTMLElement>
  /** On the canvas, where it registers with the visible-map-area seam; in the presenter, which places it itself. */
  readonly onMap: boolean
}

/**
 * A press on Retry always takes Retry away (the map or basemap shows it loading, or Retry is refused), so focus moves
 * to the chip first instead of falling to the page; when the chip itself goes while holding focus (the map
 * recovered), focus moves to its home: the map, or the presenter.
 */
function NoticeChip({ notice, shown, onRetry, focusHome, onMap }: NoticeChipProps) {
  const chip = useRef<HTMLDivElement>(null)
  const handOff = useRef(false)
  useMapOccluder(chip, 'bottom', onMap && shown, { frames: false })
  // Read before the commit removes the chip: afterwards focus has already fallen to the page.
  if (!shown && chip.current?.contains(document.activeElement)) handOff.current = true
  useLayoutEffect(() => {
    if (!handOff.current) return
    handOff.current = false
    focusHome.current?.focus({ preventScroll: true })
  })
  if (!shown) return null
  const retry = (event: MouseEvent) => {
    if (document.activeElement === event.currentTarget) chip.current?.focus()
    onRetry()
  }
  return (
    <div
      ref={chip}
      className={styles.basemapFeedback}
      data-map-notice=""
      data-tone={notice.tone}
      data-layer={onMap ? undefined : 'presenter'}
      tabIndex={-1}
    >
      <span className={styles.basemapFeedbackLead}>
        <span className={styles.basemapFeedbackDot} aria-hidden="true" />
        <span className={styles.basemapFeedbackText} role="status" aria-live="polite">{notice.statusText}</span>
      </span>
      {notice.retry && (
        <button type="button" className={styles.basemapFeedbackRetry} onClick={retry}>
          {t('canvas.layers.retryMap')}
        </button>
      )}
    </div>
  )
}
