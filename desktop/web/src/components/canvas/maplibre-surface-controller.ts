import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { MapFrame } from '../../canvas/maplibre-camera'
import { currentCanvasSession } from '../../canvas/session'
import {
  type TerrainLayerState,
} from '../../maplibre/terrain'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import { MAPLIBRE_BASEMAP_SOURCE_ID, normalizeBasemapStyle } from '../../maplibre/config'
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
import { toMapLibreSurfaceErrorMessage } from '../../maplibre/canvas-surface-errors'
import {
  createCanvasMapLibreMap,
  syncBasemapPresentation as applyBasemapPresentation,
} from '../../maplibre/canvas-basemap'
import { applyMapLibreSurfaceCamera, resolveMapLibreSurfaceFrame } from '../../maplibre/canvas-surface-camera'
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
} from '../../app/canvas-settings/signals'
import { northBearingDeg } from '../../canvas/scene-metadata-state'
import { sceneEntityRevision } from '../../canvas/runtime-mirror-state'
import { hoveredPanelTargets, selectedPanelTargets } from '../../app/panel-targets/state'
import { basemapStyle, theme } from '../../app/settings/state'
import { currentDesign } from '../../state/design'
import { loadMapLibre, type MapLibreApi, type MapLibreMapInstance } from './maplibre-loader'

interface UseMapLibreCanvasSurfaceControllerOptions {
  readonly onStateChange?: (state: MapLibreCanvasSurfaceState) => void
}

export function useMapLibreCanvasSurfaceController({
  onStateChange,
}: UseMapLibreCanvasSurfaceControllerOptions): { surfaceRef: { current: HTMLDivElement | null } } {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMapInstance | null>(null)
  const mapLibreApiRef = useRef<MapLibreApi | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const generationRef = useRef(0)
  const cameraRef = useRef<MapFrame | null>(null)
  const terrainStateRef = useRef<TerrainLayerState | null>(null)
  const basemapStyleRef = useRef<string | null>(null)
  const terrainGenerationRef = useRef(0)
  const stateRef = useRef<MapLibreCanvasSurfaceState>(IDLE_MAPLIBRE_CANVAS_SURFACE_STATE)
  const detachMapEventsRef = useRef<(() => void) | null>(null)
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  const setSurfaceState = (next: MapLibreCanvasSurfaceStateInput): void => {
    const scene = currentCanvasSession.peek()?.getSceneStore().persisted ?? null
    const merged = mergeMapLibreCanvasSurfaceState(next, scene)
    if (mapLibreCanvasSurfaceStateEquals(stateRef.current, merged)) return
    stateRef.current = merged
    onStateChangeRef.current?.(merged)
  }

  const destroyMap = (
    nextState: MapLibreCanvasSurfaceStateInput = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  ): void => {
    generationRef.current += 1
    detachMapEventsRef.current?.()
    detachMapEventsRef.current = null
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
    basemapStyleRef.current = null
    publishMapDiagnostics(null, null)
    cameraRef.current = null
    terrainStateRef.current = null
    terrainGenerationRef.current += 1
    setSurfaceState(nextState)
  }

  const syncPrecisionState = (): void => {
    const scene = currentCanvasSession.peek()?.getSceneStore().persisted ?? null
    const nextPrecision = precisionSnapshot(scene)
    setSurfaceState(stateRef.current)
    publishMapDiagnostics(cameraRef.current, nextPrecision.designExtentMeters)
  }

  const ownsCurrentMapGeneration = (
    map: MapLibreMapInstance,
    generation: number,
  ): boolean => generation === generationRef.current && map === mapRef.current

  const applyCamera = (
    map: MapLibreMapInstance,
    runtime: ReturnType<typeof currentCanvasSession.peek>,
    location: { lat: number; lon: number } | null,
    bearing: number | null,
  ): void => {
    const frame = applyMapLibreSurfaceCamera(map, runtime, location, bearing)
    if (!frame) return
    cameraRef.current = frame
    publishMapDiagnostics(frame, stateRef.current.designExtentMeters)
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
      setSurfaceState({
        ...stateRef.current,
        terrainStatus: 'error',
        terrainErrorMessage: toMapLibreSurfaceErrorMessage(error),
      })
      console.error('Failed to sync terrain layers:', error)
    }
  }

  const ensureMap = async (bearing: number | null, preferredBasemapStyle: string): Promise<void> => {
    const runtime = currentCanvasSession.peek()
    const location = currentDesign.peek()?.location ?? null
    const visibility = layerVisibility.peek()
    const visible = hasVisibleMapLayer(visibility, hillshadeVisible.peek())
    const surface = surfaceRef.current
    const nextBasemapStyle = normalizeBasemapStyle(preferredBasemapStyle)
    if (!runtime || !location || !visible || !surface) {
      destroyMap()
      return
    }

    if (mapRef.current) {
      if (basemapStyleRef.current !== nextBasemapStyle) {
        destroyMap({
          status: 'loading',
          errorMessage: null,
          terrainStatus: 'idle',
          terrainErrorMessage: null,
        })
      } else {
        mapRef.current.resize()
        applyCamera(mapRef.current, runtime, location, bearing)
        syncBasemapPresentation(mapRef.current)
        syncOverlays()
        void syncTerrain()
        return
      }
    }

    if (mapRef.current) {
      mapRef.current.resize()
      applyCamera(mapRef.current, runtime, location, bearing)
      syncBasemapPresentation(mapRef.current)
      syncOverlays()
      void syncTerrain()
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    const initialCamera = resolveMapLibreSurfaceFrame(runtime, location, bearing)
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

      const map = createCanvasMapLibreMap(maplibre, surface, initialCamera, nextBasemapStyle)
      if (generation !== generationRef.current) {
        map.remove()
        return
      }
      basemapStyleRef.current = nextBasemapStyle

      const markBasemapReady = (): void => {
        if (!ownsCurrentMapGeneration(map, generation)) return
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
        if (!ownsCurrentMapGeneration(map, generation)) return
        const sourceId = typeof event === 'object' && event && 'sourceId' in event
          ? (event as { sourceId?: unknown }).sourceId
          : undefined
        if (sourceId != null && sourceId !== MAPLIBRE_BASEMAP_SOURCE_ID) return
        if (!map.isSourceLoaded?.(MAPLIBRE_BASEMAP_SOURCE_ID)) return
        markBasemapReady()
      }

      const handleLoad = (): void => {
        if (!ownsCurrentMapGeneration(map, generation)) return
        applyCamera(map, currentCanvasSession.peek(), currentDesign.peek()?.location ?? null, northBearingDeg.peek())
        maybeMarkBasemapReady()
      }

      const handleError = (event?: unknown): void => {
        if (!ownsCurrentMapGeneration(map, generation)) return
        if (stateRef.current.status === 'ready') {
          console.error('MapLibre surface error:', event)
          return
        }
        setSurfaceState({
          status: 'error',
          errorMessage: toMapLibreSurfaceErrorMessage(event),
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
      applyCamera(map, runtime, location, bearing)
      map.resize()

      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = new ResizeObserver(() => {
        if (!ownsCurrentMapGeneration(map, generation)) return
        map.resize()
        applyCamera(
          map,
          currentCanvasSession.peek(),
          currentDesign.peek()?.location ?? null,
          northBearingDeg.peek(),
        )
      })
      resizeObserverRef.current.observe(surface)

      if (map.loaded?.()) handleLoad()
    } catch (error) {
      if (generation !== generationRef.current) return
      destroyMap({
        status: 'error',
        errorMessage: toMapLibreSurfaceErrorMessage(error),
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
    const preferredBasemapStyle = basemapStyle.value
    void runtime?.viewportRevision.value

    if (!runtime || !location || !mapVisible) {
      destroyMap()
      return
    }

    void ensureMap(bearing, preferredBasemapStyle)
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

  return { surfaceRef }
}
