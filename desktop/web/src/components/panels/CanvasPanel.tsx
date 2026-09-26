import { useRef, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { useCanvasDocumentSession } from '../../app/document-session/use-canvas-document-session'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  type MapLibreCanvasSurfaceState,
} from '../../maplibre/canvas-surface-state'
import { WelcomeScreen } from '../shared/WelcomeScreen'
import { readCanvasLayerPresentation } from '../../app/canvas-layer-presentation/presentation'
import { getMapNoticeReadModel } from '../../app/canvas-map-surface/map-notice'
import { currentDesign } from '../../app/document-session/store'
import { appCommandGraphToolbarProjection } from '../../commands/registry'
import { CanvasChrome } from '../canvas/CanvasChrome'
import { InspectionStatus } from '../canvas/InspectionStatus'
import styles from './Panels.module.css'

/** Desktop canvas: the full-bleed map with the shared floating chrome, or the start screen. */
export function CanvasPanel() {
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rulerOverlayRef = useRef<HTMLDivElement>(null)
  const [basemapState, setBasemapState] = useState<MapLibreCanvasSurfaceState>(
    () => IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  )

  useCanvasDocumentSession({
    canvasAreaRef,
    containerRef,
    rulerOverlayRef,
    onMapStateChange: setBasemapState,
  })

  const hasDesign = currentDesign.value !== null
  const locationNotice = getMapNoticeReadModel({
    hasDesign,
    mapVisible: readCanvasLayerPresentation().hasVisibleMapLayer,
    mapSurface: basemapState,
    t,
  })

  return (
    <div className={styles.canvasPanel}>
      <div ref={canvasAreaRef} className={styles.canvasArea}>
        <div
          ref={containerRef}
          className={styles.canvasContainer}
          data-map-active={locationNotice.mapSurfaceVisible ? 'true' : 'false'}
        />
        <div ref={rulerOverlayRef} className={styles.rulerOverlay} />
        {hasDesign && (
          <CanvasChrome projection={appCommandGraphToolbarProjection.value} canvasRef={containerRef}>
            {/* Read-only raster inspection; nothing here is document state. */}
            <InspectionStatus />
          </CanvasChrome>
        )}
        {locationNotice.visible && (
          <div
            className={styles.basemapFeedback}
            data-tone={locationNotice.tone}
            role="status"
            aria-live="polite"
          >
            <span className={styles.basemapFeedbackDot} aria-hidden="true" />
            <span className={styles.basemapFeedbackText}>{locationNotice.statusText}</span>
          </div>
        )}
        {!hasDesign && <WelcomeScreen />}
      </div>
    </div>
  )
}
