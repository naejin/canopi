import type { MapFrame } from '../../canvas/maplibre-camera'
import type { BasemapStyle } from '../../generated/contracts'
import {
  type TerrainLayerState,
  type TerrainProtocolSupport,
} from '../../maplibre/terrain'
import { MAPLIBRE_BASEMAP_SOURCE_ID } from '../../maplibre/config'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  mapLibreCanvasSurfaceStateEquals,
  mergeMapLibreCanvasSurfaceState,
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
import { clearCanvasMapSurfaceOverlays, syncCanvasMapSurfaceOverlays } from './overlays'
import {
  createMapLayerStackDescriptors,
  reconcileMapLayerStack,
} from './layer-stack'
import {
  applyLidarSync,
  clearLidarSync,
  classifyLidarSync,
  type LidarMapLayer,
} from './lidar'
import {
  type MapLibreApi,
  type MapLibreHostResizeObserver,
  type MapLibreMapInstance,
} from '../../maplibre/host'
import {
  createMapLibreSurfaceAdapter,
  type MapLibreSurfaceAdapter,
  type MapLibreSurfaceContext,
} from '../../maplibre/surface-adapter'
import {
  reconcileCanvasMapSurface,
  type CanvasMapSurfaceReconciliation,
} from './reconciliation'
import type { CanvasMapSurfaceSnapshot } from './types'

export type { CanvasMapSurfaceSnapshot } from './types'

export interface CanvasMapSurfaceLifecycle {
  attach(container: HTMLElement): void
  update(snapshot: CanvasMapSurfaceSnapshot): void
  destroy(nextState?: MapLibreCanvasSurfaceStateInput): void
}

export interface CanvasMapSurfaceDeps {
  readonly loadMapLibre?: () => Promise<MapLibreApi>
  readonly loadTerrainSupport: (maplibre: MapLibreApi) => Promise<TerrainProtocolSupport>
  readonly onStateChange?: (state: MapLibreCanvasSurfaceState) => void
  readonly onViewBoundsChange?: (bounds: [number, number, number, number] | null) => void
  readonly publishDiagnostics?: (frame: MapFrame | null, designExtentMeters: number | null) => void
  readonly createResizeObserver?: (callback: ResizeObserverCallback) => MapLibreHostResizeObserver | null
  readonly logError?: (message?: unknown, ...optionalParams: unknown[]) => void
}

interface CanvasMapLibreMapInstance extends MapLibreMapInstance {
  getBounds?(): {
    getWest(): number
    getSouth(): number
    getEast(): number
    getNorth(): number
  }
}

export function createCanvasMapSurfaceLifecycle(
  deps: CanvasMapSurfaceDeps,
): CanvasMapSurfaceLifecycle {
  return new ImperativeCanvasMapSurfaceLifecycle(deps)
}

class ImperativeCanvasMapSurfaceLifecycle implements CanvasMapSurfaceLifecycle {
  private readonly deps: CanvasMapSurfaceDeps
  private readonly surface: MapLibreSurfaceAdapter<MapLibreMapInstance>
  private container: HTMLElement | null = null
  private snapshot: CanvasMapSurfaceSnapshot | null = null
  private terrainGeneration = 0
  private appliedLidarLayers: LidarMapLayer[] = []
  private camera: MapFrame | null = null
  private terrainState: TerrainLayerState | null = null
  private activeBasemapStyle: BasemapStyle | null = null
  private state: MapLibreCanvasSurfaceState = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE

  constructor(deps: CanvasMapSurfaceDeps) {
    this.deps = deps
    this.surface = createMapLibreSurfaceAdapter({
      loadMapLibre: deps.loadMapLibre,
      createResizeObserver: deps.createResizeObserver,
      logError: deps.logError,
    })
  }

  attach(container: HTMLElement): void {
    if (this.container === container) return
    if (this.container) {
      this.destroyMap()
    }
    this.container = container
    this.surface.attach(container)
    void this.ensureMap()
  }

  update(snapshot: CanvasMapSurfaceSnapshot): void {
    this.snapshot = snapshot
    this.syncPrecisionState()
    void this.ensureMap()
  }

  destroy(
    nextState: MapLibreCanvasSurfaceStateInput = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  ): void {
    this.container = null
    this.destroyMap(nextState, { detachHost: true })
  }

  private setSurfaceState(next: MapLibreCanvasSurfaceStateInput): void {
    const extent = this.snapshot?.runtime?.getScenePhysicalExtentMeters() ?? null
    const merged = mergeMapLibreCanvasSurfaceState(next, extent)
    if (mapLibreCanvasSurfaceStateEquals(this.state, merged)) return
    this.state = merged
    this.deps.onStateChange?.(merged)
  }

  private destroyMap(
    nextState: MapLibreCanvasSurfaceStateInput = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
    options: { detachHost?: boolean } = {},
  ): void {
    if (options.detachHost) {
      this.surface.destroy()
    } else {
      this.surface.clearMap()
    }
    this.activeBasemapStyle = null
    this.deps.onViewBoundsChange?.(null)
    this.publishDiagnostics(null, null)
    this.camera = null
    this.terrainState = null
    this.terrainGeneration += 1
    this.setSurfaceState(nextState)
  }

  private syncPrecisionState(): void {
    this.setSurfaceState(this.state)
    this.publishDiagnostics(this.camera, this.state.designExtentMeters)
  }

  private applyCamera(map: MapLibreMapInstance, snapshot: CanvasMapSurfaceSnapshot): void {
    const frame = applyMapLibreSurfaceCamera(
      map,
      snapshot.runtime,
      snapshot.location,
      snapshot.northBearingDeg,
    )
    if (!frame) return
    this.camera = frame
    this.publishDiagnostics(frame, this.state.designExtentMeters)
    this.publishViewBounds(map)
  }

  private syncBasemapPresentation(
    map: MapLibreMapInstance,
    snapshot: CanvasMapSurfaceSnapshot,
  ): void {
    applyBasemapPresentation(
      map,
      this.state.status,
      snapshot.layerVisibility.base ?? true,
      snapshot.layerOpacity.base ?? 1,
    )
  }

  private syncLidar(map: MapLibreMapInstance, layers: readonly LidarMapLayer[]): void {
    try {
      const actions = classifyLidarSync(this.appliedLidarLayers, [...layers])
      applyLidarSync(map, actions)
      this.appliedLidarLayers = [...layers]
    } catch (error) {
      // Passive LiDAR render failures omit the contribution silently.
      this.logError('Failed to sync LiDAR layers:', error)
    }
  }

  private syncOverlays(snapshot: CanvasMapSurfaceSnapshot): void {
    const context = this.surface.current()
    if (!context) return

    syncCanvasMapSurfaceOverlays(context.map, snapshot, this.state.status === 'ready')
  }

  private reconcileLayerStack(
    map: MapLibreMapInstance,
    lidar: readonly LidarMapLayer[],
  ): void {
    try {
      reconcileMapLayerStack(map, createMapLayerStackDescriptors(lidar.map((layer) => layer.id)))
    } catch (error) {
      // Layer ordering is derived display state; keep editing available when a
      // passive MapLibre ordering update cannot be applied.
      this.logError('Failed to reconcile canvas map layer order:', error)
    }
  }

  private async syncTerrain(snapshot: CanvasMapSurfaceSnapshot): Promise<void> {
    const context = this.surface.current()
    if (!context || this.state.status !== 'ready') return
    const { map, maplibre } = context

    const nextTerrainState = snapshot.terrain
    const syncMode = classifyTerrainSync(this.terrainState, nextTerrainState)
    const terrainGeneration = this.terrainGeneration + 1
    this.terrainGeneration = terrainGeneration

    if (syncMode === 'noop') {
      this.setSurfaceState({
        ...this.state,
        terrainStatus: this.terrainState ? 'ready' : 'idle',
        terrainErrorMessage: null,
      })
      return
    }

    if (syncMode === 'clear') {
      clearTerrain(map)
      this.terrainState = null
      this.setSurfaceState({
        ...this.state,
        terrainStatus: 'idle',
        terrainErrorMessage: null,
      })
      return
    }

    if (syncMode === 'paint') {
      applyTerrainPaintUpdates(map, nextTerrainState)
      this.terrainState = nextTerrainState
      this.setSurfaceState({
        ...this.state,
        terrainStatus: 'ready',
        terrainErrorMessage: null,
      })
      return
    }

    this.setSurfaceState({
      ...this.state,
      terrainStatus: 'loading',
      terrainErrorMessage: null,
    })

    try {
      const protocols = await this.deps.loadTerrainSupport(maplibre)
      if (
        !context.isCurrent()
        || terrainGeneration !== this.terrainGeneration
        || this.state.status !== 'ready'
      ) {
        return
      }

      rebuildTerrain(map, protocols, nextTerrainState)
      this.terrainState = nextTerrainState
      this.setSurfaceState({
        ...this.state,
        terrainStatus: 'ready',
        terrainErrorMessage: null,
      })
      this.reconcileLayerStack(map, snapshot.lidar)
    } catch (error) {
      if (
        !context.isCurrent()
        || terrainGeneration !== this.terrainGeneration
      ) {
        return
      }
      clearTerrain(map)
      this.terrainState = null
      this.setSurfaceState({
        ...this.state,
        terrainStatus: 'error',
        terrainErrorMessage: toMapLibreSurfaceErrorMessage(error),
      })
      this.logError('Failed to sync terrain layers:', error)
    }
  }

  private async ensureMap(): Promise<void> {
    const snapshot = this.snapshot
    const surface = this.container
    const reconciliation = this.reconcile(snapshot, surface)
    if (reconciliation.type === 'inactive') {
      return
    }
    if (reconciliation.type === 'destroy') {
      this.destroyMap()
      return
    }

    if (!snapshot || !surface) return

    if (reconciliation.type === 'sync') {
      const context = this.surface.current()
      if (!context) return
      this.syncExistingMap(context, snapshot)
      return
    }

    if (reconciliation.type === 'rebuild') {
      this.destroyMap({
        status: 'loading',
        errorMessage: null,
        terrainStatus: 'idle',
        terrainErrorMessage: null,
      })
    }

    const initialCamera = resolveMapLibreSurfaceFrame(
      snapshot.runtime,
      snapshot.location,
      snapshot.northBearingDeg,
    )
    this.setSurfaceState({
      status: 'loading',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    })

    this.surface.requestMap({
      key: reconciliation.basemapStyle,
      createMap: (maplibre) => createCanvasMapLibreMap(
        maplibre,
        surface,
        initialCamera,
        reconciliation.basemapStyle,
      ),
      onCreate: (context) => {
        this.installCanvasMapAdapter(context, reconciliation.basemapStyle)
      },
      onResize: (context) => {
        const currentSnapshot = this.snapshot
        if (currentSnapshot) this.applyCamera(context.map, currentSnapshot)
      },
      onDestroy: (context) => {
        clearLidarSync(context.map, this.appliedLidarLayers)
        this.appliedLidarLayers = []
        clearCanvasMapSurfaceOverlays(context.map)
      },
      onCreateError: (error) => {
        this.destroyMap({
          status: 'error',
          errorMessage: toMapLibreSurfaceErrorMessage(error),
          terrainStatus: 'idle',
          terrainErrorMessage: null,
        })
      },
    })
  }

  private reconcile(
    snapshot: CanvasMapSurfaceSnapshot | null,
    surface: HTMLElement | null,
  ): CanvasMapSurfaceReconciliation {
    return reconcileCanvasMapSurface(snapshot, {
      hasContainer: surface !== null,
      hasMap: this.surface.current() !== null,
      activeBasemapStyle: this.activeBasemapStyle,
      surfaceStatus: this.state.status,
      terrainStatus: this.state.terrainStatus,
    })
  }

  private syncExistingMap(
    context: MapLibreSurfaceContext<MapLibreMapInstance>,
    snapshot: CanvasMapSurfaceSnapshot,
  ): void {
    this.surface.resize()
    this.syncBasemapPresentation(context.map, snapshot)
    // LiDAR raster bands render directly above the basemap and below every
    // overlay/terrain layer; insertion order inside the map is z-order.
    this.syncLidar(context.map, snapshot.lidar)
    this.syncOverlays(snapshot)
    this.reconcileLayerStack(context.map, snapshot.lidar)
    void this.syncTerrain(snapshot)
  }

  private installCanvasMapAdapter(
    context: MapLibreSurfaceContext<MapLibreMapInstance>,
    basemapStyle: BasemapStyle,
  ): void {
    const { map } = context
    this.activeBasemapStyle = basemapStyle

    const markBasemapReady = (): void => {
      if (!context.isCurrent()) return
      if (this.state.status === 'ready') return
      this.setSurfaceState({
        status: 'ready',
        errorMessage: null,
        terrainStatus: this.state.terrainStatus,
        terrainErrorMessage: this.state.terrainErrorMessage,
      })
      const currentSnapshot = this.snapshot
      if (!currentSnapshot) return
      this.syncBasemapPresentation(map, currentSnapshot)
      this.syncLidar(map, currentSnapshot.lidar)
      this.syncOverlays(currentSnapshot)
      this.reconcileLayerStack(map, currentSnapshot.lidar)
      void this.syncTerrain(currentSnapshot)
    }

    const maybeMarkBasemapReady = (event?: unknown): void => {
      if (!context.isCurrent()) return
      const sourceId = typeof event === 'object' && event && 'sourceId' in event
        ? (event as { sourceId?: unknown }).sourceId
        : undefined
      if (sourceId != null && sourceId !== MAPLIBRE_BASEMAP_SOURCE_ID) return
      if (!map.isSourceLoaded?.(MAPLIBRE_BASEMAP_SOURCE_ID)) return
      markBasemapReady()
    }

    const handleLoad = (): void => {
      if (!context.isCurrent()) return
      const currentSnapshot = this.snapshot
      if (!currentSnapshot) return
      this.applyCamera(map, currentSnapshot)
      maybeMarkBasemapReady()
    }

    const handleError = (event?: unknown): void => {
      if (!context.isCurrent()) return
      if (this.state.status === 'ready') {
        this.logError('MapLibre surface error:', event)
        return
      }
      this.setSurfaceState({
        status: 'error',
        errorMessage: toMapLibreSurfaceErrorMessage(event),
        terrainStatus: 'idle',
        terrainErrorMessage: null,
      })
      clearCanvasMapSurfaceOverlays(map)
    }

    const handleMoveEnd = (): void => {
      if (context.isCurrent()) this.publishViewBounds(map)
    }

    context.lifetime.on('load', handleLoad)
    context.lifetime.on('sourcedata', maybeMarkBasemapReady)
    context.lifetime.on('error', handleError)
    context.lifetime.on('moveend', handleMoveEnd)

    const currentSnapshot = this.snapshot
    if (currentSnapshot) this.applyCamera(map, currentSnapshot)
    map.resize()
    if (map.loaded?.()) handleLoad()
  }

  private publishDiagnostics(
    frame: MapFrame | null,
    designExtentMeters: number | null,
  ): void {
    const publish = this.deps.publishDiagnostics ?? publishMapDiagnostics
    publish(frame, designExtentMeters)
  }

  private publishViewBounds(map: MapLibreMapInstance): void {
    const bounds = (map as CanvasMapLibreMapInstance).getBounds?.()
    if (!bounds) return
    this.deps.onViewBoundsChange?.([
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ])
  }

  private logError(message?: unknown, ...optionalParams: unknown[]): void {
    const log = this.deps.logError ?? console.error
    log(message, ...optionalParams)
  }
}
