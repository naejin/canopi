import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { currentCanvasSession } from '../../canvas/session'
import { createMapFrame, type MapFrame } from '../../canvas/maplibre-camera'
import {
  type TerrainLayerState,
} from '../../maplibre/terrain'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import { MAPLIBRE_BASEMAP_SOURCE_ID } from '../../maplibre/config'
import { syncCanvasPanelTargetOverlays } from '../../maplibre/canvas-overlays'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  mapLibreCanvasSurfaceStateEquals,
  mergeMapLibreCanvasSurfaceState,
  precisionSnapshot,
  publishMapDiagnostics,
  type MapLibreCanvasSurfaceState,
  type MapLibreCanvasSurfaceStateInput,
} from '../../maplibre/canvas-surface-state'
import {
  createCanvasMapLibreMap,
  syncBasemapPresentation as applyBasemapPresentation,
} from '../../maplibre/canvas-basemap'
import {
  applyTerrainPaintUpdates,
  classifyTerrainSync,
  clearTerrain,
  rebuildTerrain,
} from '../../maplibre/terrain-sync'
import {
  contourIntervalMeters,
  hasVisibleMapLayer,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
  northBearingDeg,
  sceneEntityRevision,
} from '../../state/canvas'
import { hoveredPanelTargets, selectedPanelTargets } from '../../app/panel-targets/state'
import { theme } from '../../app/settings/state'
import { currentDesign } from '../../state/design'
import { loadMapLibre, type MapLibreApi, type MapLibreMapInstance } from './maplibre-loader'
import styles from './MapLibreCanvasSurface.module.css'

export type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'

export function MapLibreCanvasSurface({
  onStateChange,
}: {
  onStateChange?: (state: MapLibreCanvasSurfaceState) => void
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapInstance | null>(null)
  const mapLibreApiRef = useRef<MapLibreApi | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const generationRef = useRef(0)
  const cameraRef = useRef<MapFrame | null>(null)
  const terrainStateRef = useRef<TerrainLayerState | null>(null)
  const terrainGenerationRef = useRef(0)
  const stateRef = useRef<MapLibreCanvasSurfaceState>(IDLE_MAPLIBRE_CANVAS_SURFACE_STATE)
  const detachMapEventsRef = useRef<(() => void) | null>(null)

  const setSurfaceState = (next: MapLibreCanvasSurfaceStateInput): void => {
    const scene = currentCanvasSession.peek()?.getSceneStore().persisted ?? null
    const merged = mergeMapLibreCanvasSurfaceState(next, scene)
    if (mapLibreCanvasSurfaceStateEquals(stateRef.current, merged)) return
    stateRef.current = merged
    onStateChange?.(merged)
  }

  const destroyMap = (nextState: MapLibreCanvasSurfaceStateInput = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE): void => {
    generationRef.current += 1
    detachMapEventsRef.current?.()
    detachMapEventsRef.current = null
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
    publishMapDiagnostics(null, null)
    cameraRef.current = null
    terrainStateRef.current = null
    terrainGenerationRef.current += 1
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

  const syncPrecisionState = (): void => {
    const scene = currentCanvasSession.peek()?.getSceneStore().persisted ?? null
    const nextPrecision = precisionSnapshot(scene)
    setSurfaceState(stateRef.current)
    publishMapDiagnostics(cameraRef.current, nextPrecision.designExtentMeters)
  }

  const resolveCurrentFrame = (bearing: number | null): MapFrame | null => {
    const runtime = currentCanvasSession.peek()
    const location = currentDesign.peek()?.location ?? null
    if (!runtime || !location) return null

    return createMapFrame(
      runtime.getViewport(),
      runtime.getViewportScreenSize(),
      location,
      bearing,
    )
  }

  const applyCamera = (map: MapLibreMapInstance, bearing: number | null): void => {
    const next = resolveCurrentFrame(bearing)
    if (!next) return

    map.jumpTo({
      center: [next.center[0], next.center[1]],
      zoom: next.zoom,
      bearing: next.bearing,
    })
    cameraRef.current = next
    publishMapDiagnostics(next, stateRef.current.designExtentMeters)
  }

  const syncBasemapPresentation = (map: MapLibreMapInstance): void => {
    const basemapVisible = layerVisibility.peek().base ?? true
    applyBasemapPresentation(
      map,
      stateRef.current.status,
      basemapVisible,
      layerOpacity.peek().base ?? 1,
    )
  }

  const syncOverlays = (): void => {
    const map = mapRef.current
    const runtime = currentCanvasSession.peek()
    const location = currentDesign.peek()?.location ?? null
    if (!map) return

    syncCanvasPanelTargetOverlays(
      map,
      runtime?.getSceneStore().persisted ?? null,
      location
        ? {
            lat: location.lat,
            lon: location.lon,
            northBearingDeg: northBearingDeg.peek(),
          }
        : null,
      hoveredPanelTargets.peek(),
      selectedPanelTargets.peek(),
      stateRef.current.status === 'ready',
    )
  }

  const syncTerrain = async (): Promise<void> => {
    const map = mapRef.current
    const maplibre = mapLibreApiRef.current
    if (!map || !maplibre || stateRef.current.status !== 'ready') return

    const nextTerrainState = {
      contourIntervalMeters: contourIntervalMeters.peek(),
      contoursVisible: layerVisibility.peek().contours ?? false,
      contoursOpacity: layerOpacity.peek().contours ?? 1,
      hillshadeVisible: hillshadeVisible.peek(),
      hillshadeOpacity: hillshadeOpacity.peek(),
      isDark: theme.peek() === 'dark',
    }

    const syncMode = classifyTerrainSync(terrainStateRef.current, nextTerrainState)
    if (syncMode === 'noop') return

    if (syncMode === 'clear') {
      terrainGenerationRef.current += 1
      clearTerrain(map)
      terrainStateRef.current = null
      setSurfaceState({
        ...stateRef.current,
        terrainStatus: 'idle',
        terrainErrorMessage: null,
      })
      return
    }

    if (syncMode === 'paint') {
      applyTerrainPaintUpdates(map, nextTerrainState)
      terrainStateRef.current = nextTerrainState
      setSurfaceState({
        ...stateRef.current,
        terrainStatus: 'ready',
        terrainErrorMessage: null,
      })
      return
    }

    const terrainGeneration = terrainGenerationRef.current + 1
    terrainGenerationRef.current = terrainGeneration
    const generation = generationRef.current
    setSurfaceState({
      ...stateRef.current,
      terrainStatus: 'loading',
      terrainErrorMessage: null,
    })

    try {
      const protocols = await loadMapLibreTerrainSupport(maplibre)
      if (
        generation !== generationRef.current
        || terrainGeneration !== terrainGenerationRef.current
        || map !== mapRef.current
        || stateRef.current.status !== 'ready'
      ) {
        return
      }

      rebuildTerrain(map, protocols, nextTerrainState)
      terrainStateRef.current = nextTerrainState
      setSurfaceState({
        ...stateRef.current,
        terrainStatus: 'ready',
        terrainErrorMessage: null,
      })
    } catch (error) {
      if (
        generation !== generationRef.current
        || terrainGeneration !== terrainGenerationRef.current
        || map !== mapRef.current
      ) {
        return
      }
      clearTerrain(map)
      terrainStateRef.current = null
      const errorMessage = toErrorMessage(error)
      setSurfaceState({
        ...stateRef.current,
        terrainStatus: 'error',
        terrainErrorMessage: errorMessage,
      })
      console.error('Failed to sync terrain layers:', error)
    }
  }

  const ensureMap = async (): Promise<void> => {
    const runtime = currentCanvasSession.peek()
    const location = currentDesign.peek()?.location ?? null
    const visibility = layerVisibility.peek()
    const visible = hasVisibleMapLayer(visibility, hillshadeVisible.peek())
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
    const initialCamera = resolveCurrentFrame(northBearingDeg.peek())
    setSurfaceState({
      status: 'loading',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    })

    try {
      const maplibre = await loadMapLibre()
      if (generation !== generationRef.current) return
      mapLibreApiRef.current = maplibre

      const map = createCanvasMapLibreMap(maplibre, surface, initialCamera)
      if (generation !== generationRef.current) {
        map.remove()
        return
      }

      const markBasemapReady = (): void => {
        if (stateRef.current.status === 'ready') return
        setSurfaceState({
          status: 'ready',
          errorMessage: null,
          terrainStatus: stateRef.current.terrainStatus,
          terrainErrorMessage: stateRef.current.terrainErrorMessage,
        })
        syncBasemapPresentation(map)
        syncOverlays()
        void syncTerrain()
      }
      const maybeMarkBasemapReady = (event?: unknown): void => {
        const sourceId = typeof event === 'object' && event && 'sourceId' in event
          ? (event as { sourceId?: unknown }).sourceId
          : undefined
        if (sourceId != null && sourceId !== MAPLIBRE_BASEMAP_SOURCE_ID) return
        if (!map.isSourceLoaded?.(MAPLIBRE_BASEMAP_SOURCE_ID)) return
        markBasemapReady()
      }
      const handleLoad = (): void => {
        applyCamera(map, northBearingDeg.peek())
        maybeMarkBasemapReady()
      }
      const handleError = (event?: unknown): void => {
        if (stateRef.current.status === 'ready') {
          console.error('MapLibre surface error:', event)
          return
        }
        setSurfaceState({
          status: 'error',
          errorMessage: toErrorMessage(event),
          terrainStatus: 'idle',
          terrainErrorMessage: null,
        })
        syncCanvasPanelTargetOverlays(map, null, null, [], [], false)
      }

      map.on('load', handleLoad)
      map.on('sourcedata', maybeMarkBasemapReady)
      map.on('error', handleError)
      detachMapEventsRef.current = () => {
        map.off('load', handleLoad)
        map.off('sourcedata', maybeMarkBasemapReady)
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
        errorMessage: toErrorMessage(error),
        terrainStatus: 'idle',
        terrainErrorMessage: null,
      })
    }
  }

  useSignalEffect(() => {
    const runtime = currentCanvasSession.value
    const location = currentDesign.value?.location ?? null
    const visibleLayers = layerVisibility.value
    const mapVisible = hasVisibleMapLayer(visibleLayers, hillshadeVisible.value)
    const bearing = northBearingDeg.value
    void runtime?.viewportRevision.value

    if (!runtime || !location || !mapVisible) {
      destroyMap()
      return
    }

    void ensureMap().then(() => {
      if (mapRef.current) {
        syncBasemapPresentation(mapRef.current)
        applyCamera(mapRef.current, bearing)
        syncOverlays()
        void syncTerrain()
      }
    })
  })

  useSignalEffect(() => {
    void layerVisibility.value.base
    void layerOpacity.value.base
    if (!mapRef.current) return
    syncBasemapPresentation(mapRef.current)
  })

  useSignalEffect(() => {
    void hoveredPanelTargets.value
    void selectedPanelTargets.value
    void sceneEntityRevision.value
    syncPrecisionState()
    syncOverlays()
  })

  useSignalEffect(() => {
    void layerVisibility.value.contours
    void layerOpacity.value.contours
    void contourIntervalMeters.value
    void hillshadeVisible.value
    void hillshadeOpacity.value
    void theme.value
    void syncTerrain()
  })

  useEffect(() => () => {
    destroyMap()
  }, [])

  return <div ref={surfaceRef} className={styles.surface} aria-hidden="true" />
}
