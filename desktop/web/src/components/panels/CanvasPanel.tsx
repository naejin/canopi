import { useRef, useEffect, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { useCanvasDocumentSession } from '../../app/document-session/use-canvas-document-session'
import { CanvasToolbar } from '../canvas/CanvasToolbar'
import { CompassOverlay } from '../canvas/CompassOverlay'
import { ZoomControls } from '../canvas/ZoomControls'
import { DisplayModeControls } from '../canvas/DisplayModeControls'
import { DisplayLegend } from '../canvas/DisplayLegend'
import {
  MapLibreCanvasSurface,
} from '../canvas/MapLibreCanvasSurface'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  type MapLibreCanvasSurfaceState,
} from '../../maplibre/canvas-surface-state'
import { BottomPanel } from '../canvas/BottomPanel'
import { BottomPanelLauncher } from '../canvas/BottomPanelLauncher'
import { LayerPanel } from '../canvas/LayerPanel'
import { WelcomeScreen } from '../shared/WelcomeScreen'
import { hasVisibleMapLayer, hillshadeVisible, layerVisibility } from '../../app/canvas-settings/signals'
import { getLocationNoticeReadModel, useSavedLocationPresentation } from '../../app/location'
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
  const [locationCueVisible, setLocationCueVisible] = useState(false)
  const [canvasNoticeViewport, setCanvasNoticeViewport] = useState<CanvasNoticeViewportState>({
    canvasWidth: CANVAS_NOTICE_DEFAULT_CANVAS_WIDTH_PX,
    canvasHeight: CANVAS_NOTICE_DEFAULT_CANVAS_HEIGHT_PX,
  })
  const lastLocationRef = useRef<string | null>(null)

  useCanvasDocumentSession({ canvasAreaRef, containerRef, rulerOverlayRef })

  const savedLocation = useSavedLocationPresentation()
  const hasDesign = savedLocation.hasDesign
  const visibility = layerVisibility.value
  const mapVisible = hasVisibleMapLayer(visibility, hillshadeVisible.value)
  const locationNotice = getLocationNoticeReadModel({
    saved: savedLocation,
    mapVisible,
    mapSurface: basemapState,
    t,
  })
  const locationKey = locationNotice.locationKey

  useEffect(() => {
    if (locationKey === null) {
      lastLocationRef.current = null
      setLocationCueVisible(false)
      return
    }
    if (lastLocationRef.current === null) {
      lastLocationRef.current = locationKey
      return
    }
    if (lastLocationRef.current === locationKey) return
    lastLocationRef.current = locationKey
    setLocationCueVisible(true)
    const timer = window.setTimeout(() => setLocationCueVisible(false), 1800)
    return () => window.clearTimeout(timer)
  }, [locationKey])

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
            >
              {hasDesign && (
                <MapLibreCanvasSurface
                  onStateChange={setBasemapState}
                />
              )}
            </div>
            <div ref={rulerOverlayRef} className={styles.rulerOverlay} />
            {hasDesign && <CompassOverlay />}
            {locationNotice.visible && (
              <div
                className={styles.basemapFeedback}
                data-tone={locationNotice.tone}
                data-location-cue={locationCueVisible ? 'true' : 'false'}
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
          {hasDesign && <LayerPanel />}
        </div>
        {hasDesign && (
          <div className={styles.canvasBar}>
            <BottomPanelLauncher />
            <div className={styles.canvasBarSpacer} />
            <DisplayModeControls />
            <div className={styles.canvasBarDivider} />
            <ZoomControls />
          </div>
        )}
        {hasDesign && <BottomPanel />}
      </div>
    </div>
  )
}
