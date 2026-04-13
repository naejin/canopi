import { useRef, useEffect, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { currentDesign } from '../../state/design'
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
import { formatLocationSummary } from '../../utils/location'
import styles from './Panels.module.css'

export function CanvasPanel() {
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rulerOverlayRef = useRef<HTMLDivElement>(null)
  const [basemapState, setBasemapState] = useState<MapLibreCanvasSurfaceState>(
    () => IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  )
  const [locationCueVisible, setLocationCueVisible] = useState(false)
  const lastLocationRef = useRef<string | null>(null)

  useCanvasDocumentSession({ canvasAreaRef, containerRef, rulerOverlayRef })

  const hasDesign = currentDesign.value !== null
  const location = currentDesign.value?.location ?? null
  const hasLocation = location != null
  const visibility = layerVisibility.value
  const mapVisible = hasVisibleMapLayer(visibility, hillshadeVisible.value)
  const shouldShowMapSurface = hasDesign && hasLocation && mapVisible
  const locationSummary = location ? formatLocationSummary(location) : null
  const locationKey = location
    ? `${location.lat}:${location.lon}:${location.altitude_m ?? ''}`
    : null

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

  const basemapTone = !hasLocation
    ? 'warning'
    : basemapState.status === 'error'
      ? 'error'
      : basemapState.status === 'ready'
        ? 'ready'
        : 'loading'
  const basemapStatus = !hasLocation
    ? t('canvas.location.required')
    : basemapState.status === 'error'
      ? `${t('canvas.layers.basemapError')}: ${basemapState.errorMessage ?? ''}`.trim()
      : basemapState.status === 'ready'
        ? `${locationSummary}${basemapState.terrainStatus === 'error' ? ` • ${t('canvas.layers.mapSection')}: ${basemapState.terrainErrorMessage ?? ''}` : ''}${basemapState.precisionWarning ? ` • ${t('canvas.layers.precisionWarning')}` : ''}`
        : t('canvas.layers.basemapLoading')

  return (
    <div className={styles.canvasPanel}>
      {hasDesign && <CanvasToolbar />}

      <div className={styles.canvasColumn}>
        <div className={styles.canvasRow}>
          <div ref={canvasAreaRef} className={styles.canvasArea}>
            <div
              ref={containerRef}
              className={styles.canvasContainer}
              data-map-active={shouldShowMapSurface ? 'true' : 'false'}
            >
              {hasDesign && (
                <MapLibreCanvasSurface
                  onStateChange={setBasemapState}
                />
              )}
            </div>
            <div ref={rulerOverlayRef} className={styles.rulerOverlay} />
            {hasDesign && <CompassOverlay />}
            {hasDesign && mapVisible && (
              <div
                className={styles.basemapFeedback}
                data-tone={basemapTone}
                data-location-cue={locationCueVisible ? 'true' : 'false'}
                role="status"
                aria-live="polite"
              >
                <span className={styles.basemapFeedbackDot} aria-hidden="true" />
                <span className={styles.basemapFeedbackText}>{basemapStatus}</span>
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
