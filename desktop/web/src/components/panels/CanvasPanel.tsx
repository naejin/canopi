import { useRef, useEffect, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { autoSaveIntervalMs } from '../../state/app'
import {
  currentDesign, designName, designPath, designDirty,
  writeCanvasIntoDocument, loadCanvasFromDocument, autosaveFailed,
  consumeQueuedDocumentLoad,
  snapshotCanvasIntoCurrentDocument,
  disposeDocumentWorkflows,
  installConsortiumSync,
} from '../../state/document'
import { autosaveDesign } from '../../ipc/design'
import { getCurrentCanvasSession, setCurrentCanvasSession } from '../../canvas/session'
import { SceneCanvasRuntime } from '../../canvas/runtime/scene-runtime'
import { CanvasToolbar } from '../canvas/CanvasToolbar'
import { ZoomControls } from '../canvas/ZoomControls'
import { DisplayModeControls } from '../canvas/DisplayModeControls'
import { DisplayLegend } from '../canvas/DisplayLegend'
import {
  MapLibreCanvasSurface,
  type MapLibreCanvasSurfaceState,
} from '../canvas/MapLibreCanvasSurface'
import { BottomPanel } from '../canvas/BottomPanel'
import { BottomPanelLauncher } from '../canvas/BottomPanelLauncher'
import { LayerPanel } from '../canvas/LayerPanel'
import { WelcomeScreen } from '../shared/WelcomeScreen'
import { canvasDirty, markCanvasDetachedDirty } from '../../state/design'
import { layerVisibility } from '../../state/canvas'
import styles from './Panels.module.css'

// Autosave interval is now configurable via Rust settings (autoSaveIntervalMs signal)

function formatLocationSummary(location: { lat: number; lon: number; altitude_m: number | null }): string {
  const base = `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`
  return location.altitude_m != null ? `${base} (${location.altitude_m} m)` : base
}

function defaultBasemapState(): MapLibreCanvasSurfaceState {
  return {
    status: 'idle',
    active: false,
    errorMessage: null,
  }
}

export function CanvasPanel() {
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rulerOverlayRef = useRef<HTMLDivElement>(null)
  const [basemapActive, setBasemapActive] = useState(false)
  const [basemapState, setBasemapState] = useState<MapLibreCanvasSurfaceState>(defaultBasemapState)
  const [locationCueVisible, setLocationCueVisible] = useState(false)
  const lastLocationRef = useRef<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvasArea = canvasAreaRef.current
    if (!container || !canvasArea) return

    const runtime = new SceneCanvasRuntime()
    let cancelled = false
    let cancelQueuedLoad = () => {}
    let resizeObserver: ResizeObserver | null = null

    void runtime.init(container).then(() => {
      if (cancelled) return

      setCurrentCanvasSession(runtime)
      runtime.initializeViewport()
      if (rulerOverlayRef.current) {
        runtime.attachRulersTo(rulerOverlayRef.current)
      }
      if (currentDesign.value) {
        loadCanvasFromDocument(currentDesign.value, runtime)
        runtime.showCanvasChrome()
      } else {
        // Install consortium sync unconditionally — queued document loads
        // (OS file-open) call applyDocumentReplacement which does not go
        // through loadCanvasFromDocument, so the sync must already be active.
        installConsortiumSync()
        runtime.hideCanvasChrome()
      }

      resizeObserver = new ResizeObserver(() => {
        runtime.resize(canvasArea.clientWidth, canvasArea.clientHeight)
      })
      resizeObserver.observe(canvasArea)
      cancelQueuedLoad = consumeQueuedDocumentLoad(runtime)
    }).catch((error) => {
      console.error('Failed to initialize scene canvas runtime:', error)
    })

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      cancelQueuedLoad()
      if (currentDesign.value) {
        try {
          snapshotCanvasIntoCurrentDocument(runtime, designName.value)
          markCanvasDetachedDirty(canvasDirty.value)
        } catch (error) {
          console.error('Failed to snapshot canvas before teardown:', error)
        }
      }
      disposeDocumentWorkflows()
      runtime.destroy()
      setCurrentCanvasSession(null)
    }
  }, [])

  // Autosave timer — reactive to autoSaveIntervalMs changes.
  // Separate from engine mount so the interval recreates when settings change.
  const intervalMs = autoSaveIntervalMs.value
  useEffect(() => {
    const timer = setInterval(() => {
      if (!designDirty.value) return
      const session = getCurrentCanvasSession()
      if (!session) return
      const content = writeCanvasIntoDocument(session, designName.value)
      autosaveDesign(content, designPath.value)
        .then(() => { autosaveFailed.value = false })
        .catch((err) => {
          console.error('Autosave failed:', err)
          autosaveFailed.value = true
        })
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  const hasDesign = currentDesign.value !== null
  const location = currentDesign.value?.location ?? null
  const hasLocation = location != null
  const basemapVisible = layerVisibility.value.base ?? true
  const shouldShowBasemap = hasDesign && hasLocation && basemapVisible
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
        ? `${t('canvas.location.current')}: ${locationSummary}`
        : t('canvas.layers.basemapLoading')

  return (
    <div className={styles.canvasPanel}>
      {hasDesign && <CanvasToolbar />}

      <div className={styles.canvasColumn}>
        <div className={styles.canvasRow}>
          <div ref={canvasAreaRef} className={styles.canvasArea}>
            {hasDesign && (
              <MapLibreCanvasSurface
                onActiveChange={setBasemapActive}
                onStateChange={setBasemapState}
              />
            )}
            <div
              ref={containerRef}
              className={styles.canvasContainer}
              data-basemap-active={shouldShowBasemap && basemapActive ? 'true' : 'false'}
            />
            <div ref={rulerOverlayRef} className={styles.rulerOverlay} />
            {hasDesign && basemapVisible && (
              <div
                className={styles.basemapFeedback}
                data-tone={basemapTone}
                data-location-cue={locationCueVisible ? 'true' : 'false'}
                role="status"
                aria-live="polite"
              >
                <span className={styles.basemapFeedbackHeader}>
                  <span className={styles.basemapFeedbackDot} aria-hidden="true" />
                  <span className={styles.basemapFeedbackLabel}>{t('canvas.layers.basemap')}</span>
                </span>
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
