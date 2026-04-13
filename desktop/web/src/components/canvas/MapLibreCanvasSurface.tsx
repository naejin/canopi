import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { currentCanvasSession } from '../../canvas/session'
import { computeMapLibreCamera } from '../../canvas/maplibre-camera'
import {
  buildPanelTargetProjectionScene,
  createPanelTargetMapOverlayContract,
} from '../../maplibre/panel-target-overlays'
import { clearPanelTargetMapOverlay, syncPanelTargetMapOverlay } from '../../maplibre/panel-target-overlay-sync'
import { DEFAULT_MAPLIBRE_BASEMAP_STYLE_URL } from '../../maplibre/config'
import {
  hoveredPanelTargets,
  layerOpacity,
  layerVisibility,
  northBearingDeg,
  sceneEntityRevision,
  selectedPanelTargets,
} from '../../state/canvas'
import { currentDesign } from '../../state/document'
import { projectPanelTargetsToMapFeatures } from '../../panel-target-map-projection'
import { loadMapLibre, type MapLibreMapInstance } from './maplibre-loader'
import styles from './MapLibreCanvasSurface.module.css'

interface MapCameraSnapshot {
  readonly center: readonly [number, number]
  readonly zoom: number
  readonly bearing: number
}

export type MapLibreCanvasSurfaceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MapLibreCanvasSurfaceState {
  readonly status: MapLibreCanvasSurfaceStatus
  readonly active: boolean
  readonly errorMessage: string | null
}

const IDLE_STATE: MapLibreCanvasSurfaceState = {
  status: 'idle',
  active: false,
  errorMessage: null,
}

export function MapLibreCanvasSurface({
  onActiveChange,
  onStateChange,
}: {
  onActiveChange?: (active: boolean) => void
  onStateChange?: (state: MapLibreCanvasSurfaceState) => void
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapInstance | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const generationRef = useRef(0)
  const cameraRef = useRef<MapCameraSnapshot | null>(null)
  const stateRef = useRef<MapLibreCanvasSurfaceState>(IDLE_STATE)
  const detachMapEventsRef = useRef<(() => void) | null>(null)

  const setSurfaceState = (next: MapLibreCanvasSurfaceState): void => {
    const previous = stateRef.current
    if (
      previous.status === next.status
      && previous.active === next.active
      && previous.errorMessage === next.errorMessage
    ) {
      return
    }
    stateRef.current = next
    if (previous.active !== next.active) {
      onActiveChange?.(next.active)
    }
    onStateChange?.(next)
  }

  const destroyMap = (nextState: MapLibreCanvasSurfaceState = IDLE_STATE): void => {
    generationRef.current += 1
    detachMapEventsRef.current?.()
    detachMapEventsRef.current = null
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
    cameraRef.current = null
    setSurfaceState(nextState)
  }

  const toErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === 'string' && error.length > 0) return error
    if (typeof error === 'object' && error && 'error' in error) {
      return toErrorMessage((error as { error?: unknown }).error)
    }
    return 'Unable to load basemap'
  }

  const applyCamera = (map: MapLibreMapInstance, bearing: number | null): void => {
    const runtime = currentCanvasSession.peek()
    const location = currentDesign.peek()?.location ?? null
    if (!runtime || !location) return

    const next = computeMapLibreCamera(
      runtime.getViewport(),
      runtime.getViewportScreenSize(),
      location,
      bearing,
    )
    if (!next) return
    const previous = cameraRef.current
    if (
      previous
      && Math.abs(previous.center[0] - next.center[0]) < 0.000001
      && Math.abs(previous.center[1] - next.center[1]) < 0.000001
      && Math.abs(previous.zoom - next.zoom) < 0.000001
      && Math.abs(previous.bearing - next.bearing) < 0.000001
    ) {
      return
    }

    map.jumpTo({
      center: [next.center[0], next.center[1]],
      zoom: next.zoom,
      bearing: next.bearing,
    })
    cameraRef.current = next
  }

  const syncOverlays = (): void => {
    const map = mapRef.current
    const runtime = currentCanvasSession.peek()
    const location = currentDesign.peek()?.location ?? null
    if (!map || !runtime || !location || stateRef.current.status !== 'ready') {
      if (map) {
        clearPanelTargetMapOverlay(map, 'hover')
        clearPanelTargetMapOverlay(map, 'selection')
      }
      return
    }

    const scene = buildPanelTargetProjectionScene(runtime.getSceneStore().persisted)
    const hoverOverlay = createPanelTargetMapOverlayContract(
      'hover',
      projectPanelTargetsToMapFeatures(hoveredPanelTargets.peek(), scene, location),
    )
    const selectionOverlay = createPanelTargetMapOverlayContract(
      'selection',
      projectPanelTargetsToMapFeatures(selectedPanelTargets.peek(), scene, location),
    )

    syncPanelTargetMapOverlay(map, selectionOverlay)
    syncPanelTargetMapOverlay(map, hoverOverlay)
  }

  const ensureMap = async (): Promise<void> => {
    const runtime = currentCanvasSession.peek()
    const location = currentDesign.peek()?.location ?? null
    const visible = layerVisibility.peek().base ?? true
    const surface = surfaceRef.current
    if (!runtime || !location || !visible || !surface) {
      destroyMap()
      return
    }

    if (mapRef.current) {
      mapRef.current.resize()
      applyCamera(mapRef.current, northBearingDeg.peek())
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    setSurfaceState({
      status: 'loading',
      active: false,
      errorMessage: null,
    })

    try {
      const maplibre = await loadMapLibre()
      if (generation !== generationRef.current) return

      const map = new maplibre.Map({
        container: surface,
        style: DEFAULT_MAPLIBRE_BASEMAP_STYLE_URL,
        attributionControl: false,
        interactive: false,
        pitchWithRotate: false,
        dragRotate: false,
        touchZoomRotate: false,
      })
      if (generation !== generationRef.current) {
        map.remove()
        return
      }

      const handleLoad = (): void => {
        setSurfaceState({
          status: 'ready',
          active: true,
          errorMessage: null,
        })
        syncOverlays()
      }
      const handleError = (event?: unknown): void => {
        setSurfaceState({
          status: 'error',
          active: false,
          errorMessage: toErrorMessage(event),
        })
        clearPanelTargetMapOverlay(map, 'hover')
        clearPanelTargetMapOverlay(map, 'selection')
      }

      map.on('load', handleLoad)
      map.on('error', handleError)
      detachMapEventsRef.current = () => {
        map.off('load', handleLoad)
        map.off('error', handleError)
      }
      mapRef.current = map
      applyCamera(map, northBearingDeg.peek())
      map.resize()

      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = new ResizeObserver(() => {
        if (!mapRef.current) return
        mapRef.current.resize()
        applyCamera(mapRef.current, northBearingDeg.peek())
      })
      resizeObserverRef.current.observe(surface)

      if (map.loaded?.()) handleLoad()
    } catch (error) {
      if (generation !== generationRef.current) return
      destroyMap({
        status: 'error',
        active: false,
        errorMessage: toErrorMessage(error),
      })
    }
  }

  useSignalEffect(() => {
    const opacity = layerOpacity.value.base ?? 1
    if (surfaceRef.current) surfaceRef.current.style.opacity = String(opacity)
  })

  useSignalEffect(() => {
    const runtime = currentCanvasSession.value
    const location = currentDesign.value?.location ?? null
    const visible = layerVisibility.value.base ?? true
    const bearing = northBearingDeg.value
    void runtime?.viewportRevision.value

    if (!runtime || !location || !visible) {
      destroyMap()
      return
    }

    void ensureMap().then(() => {
      if (mapRef.current) {
        applyCamera(mapRef.current, bearing)
        syncOverlays()
      }
    })
  })

  useSignalEffect(() => {
    void hoveredPanelTargets.value
    void selectedPanelTargets.value
    void sceneEntityRevision.value
    syncOverlays()
  })

  useEffect(() => () => {
    destroyMap()
  }, [])

  return <div ref={surfaceRef} className={styles.surface} aria-hidden="true" />
}
