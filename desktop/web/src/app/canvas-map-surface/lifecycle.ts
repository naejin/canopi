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
import type { MapLibreApi, MapLibreMapInstance } from '../../components/canvas/maplibre-loader'
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

interface CanvasMapSurfaceResizeObserver {
  observe(target: Element): void
  disconnect(): void
}

export interface CanvasMapSurfaceDeps {
  readonly loadMapLibre: () => Promise<MapLibreApi>
  readonly loadTerrainSupport: (maplibre: MapLibreApi) => Promise<TerrainProtocolSupport>
  readonly onStateChange?: (state: MapLibreCanvasSurfaceState) => void
  readonly publishDiagnostics?: (frame: MapFrame | null, designExtentMeters: number | null) => void
  readonly createResizeObserver?: (callback: ResizeObserverCallback) => CanvasMapSurfaceResizeObserver | null
  readonly logError?: (message?: unknown, ...optionalParams: unknown[]) => void
}

export function createCanvasMapSurfaceLifecycle(
  deps: CanvasMapSurfaceDeps,
): CanvasMapSurfaceLifecycle {
  return new ImperativeCanvasMapSurfaceLifecycle(deps)
}

class ImperativeCanvasMapSurfaceLifecycle implements CanvasMapSurfaceLifecycle {
  private readonly deps: CanvasMapSurfaceDeps
  private container: HTMLElement | null = null
  private snapshot: CanvasMapSurfaceSnapshot | null = null
  private map: MapLibreMapInstance | null = null
  private maplibre: MapLibreApi | null = null
  private resizeObserver: CanvasMapSurfaceResizeObserver | null = null
  private generation = 0
  private terrainGeneration = 0
  private camera: MapFrame | null = null
  private terrainState: TerrainLayerState | null = null
  private activeBasemapStyle: BasemapStyle | null = null
  private state: MapLibreCanvasSurfaceState = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE
  private detachMapEvents: (() => void) | null = null

  constructor(deps: CanvasMapSurfaceDeps) {
    this.deps = deps
  }

  attach(container: HTMLElement): void {
    if (this.container === container) return
    if (this.container) {
      this.destroyMap()
    }
    this.container = container
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
    this.destroyMap(nextState)
  }

  private setSurfaceState(next: MapLibreCanvasSurfaceStateInput): void {
    const scene = this.snapshot?.runtime?.getSceneSnapshot() ?? null
    const merged = mergeMapLibreCanvasSurfaceState(next, scene)
    if (mapLibreCanvasSurfaceStateEquals(this.state, merged)) return
    this.state = merged
    this.deps.onStateChange?.(merged)
  }

  private destroyMap(
    nextState: MapLibreCanvasSurfaceStateInput = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  ): void {
    this.generation += 1
    this.detachMapEvents?.()
    this.detachMapEvents = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.map) {
      clearCanvasMapSurfaceOverlays(this.map)
      this.map.remove()
      this.map = null
    }
    this.activeBasemapStyle = null
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

  private ownsCurrentMapGeneration(
    map: MapLibreMapInstance,
    generation: number,
  ): boolean {
    return generation === this.generation && map === this.map
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

  private syncOverlays(snapshot: CanvasMapSurfaceSnapshot): void {
    if (!this.map) return

    syncCanvasMapSurfaceOverlays(this.map, snapshot, this.state.status === 'ready')
  }

  private async syncTerrain(snapshot: CanvasMapSurfaceSnapshot): Promise<void> {
    const map = this.map
    const maplibre = this.maplibre
    if (!map || !maplibre || this.state.status !== 'ready') return

    const nextTerrainState = snapshot.terrain
    const syncMode = classifyTerrainSync(this.terrainState, nextTerrainState)
    if (syncMode === 'noop') return

    if (syncMode === 'clear') {
      this.terrainGeneration += 1
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

    const terrainGeneration = this.terrainGeneration + 1
    this.terrainGeneration = terrainGeneration
    const generation = this.generation
    this.setSurfaceState({
      ...this.state,
      terrainStatus: 'loading',
      terrainErrorMessage: null,
    })

    try {
      const protocols = await this.deps.loadTerrainSupport(maplibre)
      if (
        generation !== this.generation
        || terrainGeneration !== this.terrainGeneration
        || map !== this.map
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
    } catch (error) {
      if (
        generation !== this.generation
        || terrainGeneration !== this.terrainGeneration
        || map !== this.map
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
      if (!this.map) return
      this.syncExistingMap(this.map, snapshot)
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

    const generation = this.generation + 1
    this.generation = generation
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

    try {
      const maplibre = await this.deps.loadMapLibre()
      if (generation !== this.generation) return
      this.maplibre = maplibre

      const map = createCanvasMapLibreMap(
        maplibre,
        surface,
        initialCamera,
        reconciliation.basemapStyle,
      )
      if (generation !== this.generation) {
        map.remove()
        return
      }
      this.activeBasemapStyle = reconciliation.basemapStyle

      const markBasemapReady = (): void => {
        if (!this.ownsCurrentMapGeneration(map, generation)) return
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
        this.syncOverlays(currentSnapshot)
        void this.syncTerrain(currentSnapshot)
      }

      const maybeMarkBasemapReady = (event?: unknown): void => {
        if (!this.ownsCurrentMapGeneration(map, generation)) return
        const sourceId = typeof event === 'object' && event && 'sourceId' in event
          ? (event as { sourceId?: unknown }).sourceId
          : undefined
        if (sourceId != null && sourceId !== MAPLIBRE_BASEMAP_SOURCE_ID) return
        if (!map.isSourceLoaded?.(MAPLIBRE_BASEMAP_SOURCE_ID)) return
        markBasemapReady()
      }

      const handleLoad = (): void => {
        if (!this.ownsCurrentMapGeneration(map, generation)) return
        const currentSnapshot = this.snapshot
        if (!currentSnapshot) return
        this.applyCamera(map, currentSnapshot)
        maybeMarkBasemapReady()
      }

      const handleError = (event?: unknown): void => {
        if (!this.ownsCurrentMapGeneration(map, generation)) return
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

      map.on('load', handleLoad)
      map.on('sourcedata', maybeMarkBasemapReady)
      map.on('error', handleError)
      this.detachMapEvents = () => {
        map.off('load', handleLoad)
        map.off('sourcedata', maybeMarkBasemapReady)
        map.off('error', handleError)
      }

      this.map = map
      this.applyCamera(map, snapshot)
      map.resize()
      this.installResizeObserver(map, generation, surface)

      if (map.loaded?.()) handleLoad()
    } catch (error) {
      if (generation !== this.generation) return
      this.destroyMap({
        status: 'error',
        errorMessage: toMapLibreSurfaceErrorMessage(error),
        terrainStatus: 'idle',
        terrainErrorMessage: null,
      })
    }
  }

  private reconcile(
    snapshot: CanvasMapSurfaceSnapshot | null,
    surface: HTMLElement | null,
  ): CanvasMapSurfaceReconciliation {
    return reconcileCanvasMapSurface(snapshot, {
      hasContainer: surface !== null,
      hasMap: this.map !== null,
      activeBasemapStyle: this.activeBasemapStyle,
      surfaceStatus: this.state.status,
      terrainStatus: this.state.terrainStatus,
    })
  }

  private syncExistingMap(
    map: MapLibreMapInstance,
    snapshot: CanvasMapSurfaceSnapshot,
  ): void {
    map.resize()
    this.applyCamera(map, snapshot)
    this.syncBasemapPresentation(map, snapshot)
    this.syncOverlays(snapshot)
    void this.syncTerrain(snapshot)
  }

  private installResizeObserver(
    map: MapLibreMapInstance,
    generation: number,
    surface: HTMLElement,
  ): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = this.createResizeObserver(() => {
      if (!this.ownsCurrentMapGeneration(map, generation)) return
      map.resize()
      const currentSnapshot = this.snapshot
      if (currentSnapshot) this.applyCamera(map, currentSnapshot)
    })
    this.resizeObserver?.observe(surface)
  }

  private createResizeObserver(
    callback: ResizeObserverCallback,
  ): CanvasMapSurfaceResizeObserver | null {
    if (this.deps.createResizeObserver) return this.deps.createResizeObserver(callback)
    if (typeof ResizeObserver === 'undefined') return null
    return new ResizeObserver(callback)
  }

  private publishDiagnostics(
    frame: MapFrame | null,
    designExtentMeters: number | null,
  ): void {
    const publish = this.deps.publishDiagnostics ?? publishMapDiagnostics
    publish(frame, designExtentMeters)
  }

  private logError(message?: unknown, ...optionalParams: unknown[]): void {
    const log = this.deps.logError ?? console.error
    log(message, ...optionalParams)
  }
}
