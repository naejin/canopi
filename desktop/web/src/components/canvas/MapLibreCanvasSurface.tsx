import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { currentCanvasSession } from '../../canvas/session'
import { createMapFrame, type MapFrame } from '../../canvas/maplibre-camera'
import {
  TERRAIN_CONTOUR_LAYER_IDS,
  TERRAIN_CONTOUR_SOURCE_ID,
  TERRAIN_DEM_SOURCE_ID,
  TERRAIN_HILLSHADE_LAYER_ID,
  createTerrainLayers,
  createTerrainSources,
  type TerrainLayerState,
} from '../../maplibre/terrain'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import {
  buildPanelTargetProjectionScene,
  createPanelTargetMapOverlayContract,
} from '../../maplibre/panel-target-overlays'
import { clearPanelTargetMapOverlay, syncPanelTargetMapOverlay } from '../../maplibre/panel-target-overlay-sync'
import {
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  createDefaultMapLibreBasemapStyle,
  MAPLIBRE_BASEMAP_SOURCE_ID,
  REMOTE_BASEMAP_TILE_URL_TEMPLATE,
} from '../../maplibre/config'
import {
  contourIntervalMeters,
  hasVisibleMapLayer,
  hoveredPanelTargets,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
  northBearingDeg,
  sceneEntityRevision,
  selectedPanelTargets,
} from '../../state/canvas'
import { theme } from '../../state/app'
import { currentDesign } from '../../state/document'
import { projectPanelTargetsToMapFeatures } from '../../panel-target-map-projection'
import type { ScenePersistedState } from '../../canvas/runtime/scene'
import { loadMapLibre, type MapLibreApi, type MapLibreMapInstance } from './maplibre-loader'
import styles from './MapLibreCanvasSurface.module.css'

export type MapLibreCanvasSurfaceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MapLibreCanvasSurfaceState {
  readonly status: MapLibreCanvasSurfaceStatus
  readonly errorMessage: string | null
  readonly terrainStatus: MapLibreCanvasSurfaceStatus
  readonly terrainErrorMessage: string | null
  readonly precisionWarning: boolean
  readonly designExtentMeters: number | null
}

type MapLibreCanvasSurfaceStateInput = Omit<
  MapLibreCanvasSurfaceState,
  'precisionWarning' | 'designExtentMeters'
>

const IDLE_STATE: MapLibreCanvasSurfaceState = {
  status: 'idle',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
  precisionWarning: false,
  designExtentMeters: null,
}

const LOCAL_PROJECTION_WARNING_THRESHOLD_METERS = 10_000

function computeSceneExtentMeters(scene: ScenePersistedState): number | null {
  let maxDistanceMeters = 0
  let hasGeometry = false

  const includePoint = (x: number, y: number) => {
    hasGeometry = true
    maxDistanceMeters = Math.max(maxDistanceMeters, Math.hypot(x, y))
  }

  for (const plant of scene.plants) includePoint(plant.position.x, plant.position.y)
  for (const zone of scene.zones) {
    for (const point of zone.points) includePoint(point.x, point.y)
  }
  for (const annotation of scene.annotations) includePoint(annotation.position.x, annotation.position.y)
  for (const group of scene.groups) includePoint(group.position.x, group.position.y)

  return hasGeometry ? maxDistanceMeters : null
}

function publishMapDiagnostics(frame: MapFrame | null, designExtentMeters: number | null): void {
  if (!import.meta.env.DEV) return
  ;(globalThis as { __CANOPI_MAP_DEBUG__?: unknown }).__CANOPI_MAP_DEBUG__ = frame
    ? {
      center: frame.center,
      zoom: frame.zoom,
      bearing: frame.bearing,
      viewportCenterWorld: frame.diagnostics.viewportCenterWorld,
      viewportCornerGeo: frame.diagnostics.viewportCornerGeo,
      designExtentMeters,
      precisionWarning: designExtentMeters != null && designExtentMeters > LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
    }
    : null
}

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
  const stateRef = useRef<MapLibreCanvasSurfaceState>(IDLE_STATE)
  const detachMapEventsRef = useRef<(() => void) | null>(null)

  const precisionSnapshot = (): Pick<MapLibreCanvasSurfaceState, 'precisionWarning' | 'designExtentMeters'> => {
    const scene = currentCanvasSession.peek()?.getSceneStore().persisted ?? null
    const designExtentMeters = scene ? computeSceneExtentMeters(scene) : null
    return {
      precisionWarning: designExtentMeters != null && designExtentMeters > LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
      designExtentMeters,
    }
  }

  const setSurfaceState = (next: MapLibreCanvasSurfaceStateInput): void => {
    const merged = {
      ...next,
      ...precisionSnapshot(),
    }
    const previous = stateRef.current
    if (
      previous.status === merged.status
      && previous.errorMessage === merged.errorMessage
      && previous.terrainStatus === merged.terrainStatus
      && previous.terrainErrorMessage === merged.terrainErrorMessage
      && previous.precisionWarning === merged.precisionWarning
      && previous.designExtentMeters === merged.designExtentMeters
    ) {
      return
    }
    stateRef.current = merged
    onStateChange?.(merged)
  }

  const destroyMap = (nextState: MapLibreCanvasSurfaceStateInput = IDLE_STATE): void => {
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

  const clearTerrain = (map: MapLibreMapInstance): void => {
    const terrainLayerIds = [
      ...TERRAIN_CONTOUR_LAYER_IDS,
      TERRAIN_HILLSHADE_LAYER_ID,
    ]
    for (const layerId of terrainLayerIds) {
      if (map.getLayer(layerId)) map.removeLayer(layerId)
    }
    if (map.getSource(TERRAIN_CONTOUR_SOURCE_ID)) map.removeSource(TERRAIN_CONTOUR_SOURCE_ID)
    if (map.getSource(TERRAIN_DEM_SOURCE_ID)) map.removeSource(TERRAIN_DEM_SOURCE_ID)
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
    const nextPrecision = precisionSnapshot()
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

  const isStyleReady = (map: MapLibreMapInstance): boolean => {
    const isStyleLoaded = map.isStyleLoaded?.()
    if (typeof isStyleLoaded === 'boolean') return isStyleLoaded
    return stateRef.current.status === 'ready'
  }

  const syncBasemapPresentation = (map: MapLibreMapInstance): void => {
    if (!isStyleReady(map)) return

    const basemapVisible = layerVisibility.peek().base ?? true
    const basemapOpacity = basemapVisible ? (layerOpacity.peek().base ?? 1) : 0
    map.setPaintProperty?.(
      MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
      'background-opacity',
      basemapOpacity,
    )
    map.setPaintProperty?.(
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      'raster-opacity',
      basemapOpacity,
    )
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
    const projectionLocation = {
      lat: location.lat,
      lon: location.lon,
      northBearingDeg: northBearingDeg.peek(),
    }
    const hoverOverlay = createPanelTargetMapOverlayContract(
      'hover',
      projectPanelTargetsToMapFeatures(hoveredPanelTargets.peek(), scene, projectionLocation),
    )
    const selectionOverlay = createPanelTargetMapOverlayContract(
      'selection',
      projectPanelTargetsToMapFeatures(selectedPanelTargets.peek(), scene, projectionLocation),
    )

    syncPanelTargetMapOverlay(map, selectionOverlay)
    syncPanelTargetMapOverlay(map, hoverOverlay)
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

    if (!nextTerrainState.contoursVisible && !nextTerrainState.hillshadeVisible) {
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

    const previousTerrainState = terrainStateRef.current
    if (
      previousTerrainState
      && previousTerrainState.contourIntervalMeters === nextTerrainState.contourIntervalMeters
      && previousTerrainState.contoursVisible === nextTerrainState.contoursVisible
      && previousTerrainState.contoursOpacity === nextTerrainState.contoursOpacity
      && previousTerrainState.hillshadeVisible === nextTerrainState.hillshadeVisible
      && previousTerrainState.hillshadeOpacity === nextTerrainState.hillshadeOpacity
      && previousTerrainState.isDark === nextTerrainState.isDark
    ) {
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

      clearTerrain(map)

      const terrainSources = createTerrainSources(protocols, nextTerrainState)
      for (const { id, source } of terrainSources) {
        map.addSource(id, source)
      }
      const terrainLayers = createTerrainLayers(nextTerrainState)
      for (const layer of terrainLayers) {
        map.addLayer(layer)
      }
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

      const map = new maplibre.Map({
        container: surface,
        style: createDefaultMapLibreBasemapStyle(REMOTE_BASEMAP_TILE_URL_TEMPLATE),
        center: initialCamera ? [initialCamera.center[0], initialCamera.center[1]] : undefined,
        zoom: initialCamera?.zoom,
        bearing: initialCamera?.bearing,
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
        clearPanelTargetMapOverlay(map, 'hover')
        clearPanelTargetMapOverlay(map, 'selection')
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
