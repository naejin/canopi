import { SpeciesFocusChip } from '../canvas/SpeciesFocusChip'
import { useRef, useEffect, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { useCanvasDocumentSession } from '../../app/document-session/use-canvas-document-session'
import { CanvasToolbar } from '../canvas/CanvasToolbar'
import { ZoomControls } from '../canvas/ZoomControls'
import { InspectionLens } from '../canvas/InspectionLens'
import { InspectionStatus } from '../canvas/InspectionStatus'
import { DisplayLegend } from '../canvas/DisplayLegend'
import { CanvasOverview } from '../canvas/CanvasOverview'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  type MapLibreCanvasSurfaceState,
} from '../../maplibre/canvas-surface-state'
import { WelcomeScreen } from '../shared/WelcomeScreen'
import { readCanvasLayerPresentation } from '../../app/canvas-layer-presentation/presentation'
import { getMapNoticeReadModel } from '../../app/canvas-map-surface/map-notice'
import { currentDesign } from '../../app/document-session/store'
import {
  CANVAS_NOTICE_DEFAULT_CANVAS_HEIGHT_PX,
  CANVAS_NOTICE_DEFAULT_CANVAS_WIDTH_PX,
  resolveCanvasNoticePlacement,
} from '../../canvas/canvas-notice-layout'
import styles from './Panels.module.css'

interface CanvasNoticeViewportState {
  canvasWidth: number
  canvasHeight: number
}

function readCanvasNoticeViewport(element: HTMLElement): CanvasNoticeViewportState {
  const rect = element.getBoundingClientRect()
  return {
    canvasWidth: element.clientWidth || Math.round(rect.width) || CANVAS_NOTICE_DEFAULT_CANVAS_WIDTH_PX,
    canvasHeight: element.clientHeight || Math.round(rect.height) || CANVAS_NOTICE_DEFAULT_CANVAS_HEIGHT_PX,
  }
}

export function CanvasPanel() {
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rulerOverlayRef = useRef<HTMLDivElement>(null)
  const [basemapState, setBasemapState] = useState<MapLibreCanvasSurfaceState>(
    () => IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  )
  const [canvasNoticeViewport, setCanvasNoticeViewport] = useState<CanvasNoticeViewportState>({
    canvasWidth: CANVAS_NOTICE_DEFAULT_CANVAS_WIDTH_PX,
    canvasHeight: CANVAS_NOTICE_DEFAULT_CANVAS_HEIGHT_PX,
  })

  useCanvasDocumentSession({
    canvasAreaRef,
    containerRef,
    rulerOverlayRef,
    onMapStateChange: setBasemapState,
  })

  const hasDesign = currentDesign.value !== null
  const mapVisible = readCanvasLayerPresentation().hasVisibleMapLayer
  const locationNotice = getMapNoticeReadModel({
    hasDesign,
    mapVisible,
    mapSurface: basemapState,
    t,
  })

  useEffect(() => {
    if (!hasDesign) return
    const element = canvasAreaRef.current
    if (!element) return

    const updateViewport = () => {
      const next = readCanvasNoticeViewport(element)
      setCanvasNoticeViewport((previous) => {
        if (
          previous.canvasWidth === next.canvasWidth
          && previous.canvasHeight === next.canvasHeight
        ) {
          return previous
        }
        return next
      })
    }

    updateViewport()
    const observer = new ResizeObserver(updateViewport)
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasDesign])

  const locationNoticePlacement = resolveCanvasNoticePlacement('location-notice', {
    canvasWidth: canvasNoticeViewport.canvasWidth,
    canvasHeight: canvasNoticeViewport.canvasHeight,
    rulersVisible: true,
    scaleBarVisible: true,
  })
  const locationNoticeStyle = {
    top: 'auto',
    left: `${locationNoticePlacement.leftPx}px`,
    bottom: `${locationNoticePlacement.bottomPx}px`,
    maxWidth: `${Math.min(320, locationNoticePlacement.maxWidthPx)}px`,
  }

  return (
    <div className={styles.canvasPanel}>
      {hasDesign && <CanvasToolbar />}

      <div className={styles.canvasColumn}>
        <div className={styles.canvasRow}>
          <div ref={canvasAreaRef} className={styles.canvasArea}>
            <div
              ref={containerRef}
              className={styles.canvasContainer}
              data-map-active={locationNotice.mapSurfaceVisible ? 'true' : 'false'}
            />
            <div ref={rulerOverlayRef} className={styles.rulerOverlay} />
            {hasDesign && <InspectionLens canvasRef={containerRef} />}
            {/* Read-only numeric inspection; nothing here is document state. */}
            {hasDesign && <InspectionStatus />}
            {hasDesign && <SpeciesFocusChip />}
            {hasDesign && <CanvasOverview />}
            {locationNotice.visible && (
              <div
                className={styles.basemapFeedback}
                data-tone={locationNotice.tone}
                data-location-notice-placement={locationNoticePlacement.placement}
                data-compact={locationNoticePlacement.compact ? 'true' : 'false'}
                style={locationNoticeStyle}
                role="status"
                aria-live="polite"
              >
                <span className={styles.basemapFeedbackDot} aria-hidden="true" />
                <span className={styles.basemapFeedbackText}>{locationNotice.statusText}</span>
              </div>
            )}

            {!hasDesign && <WelcomeScreen />}
            {hasDesign && <DisplayLegend />}
          </div>

        </div>
        {hasDesign && (
          <div className={styles.canvasBar}>
            <div className={styles.canvasBarSpacer} />
            <ZoomControls />
          </div>
        )}
      </div>
    </div>
  )
}
