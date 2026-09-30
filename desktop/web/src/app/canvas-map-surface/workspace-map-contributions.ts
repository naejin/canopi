import { logMapError } from '../../maplibre/redact-credentials'
import type { ViewDiagnostics } from '../../canvas/runtime/view/types'
import type { MapLibreSurfaceContext } from '../../maplibre/surface-adapter'
import type { MapLibreMapInstance } from '../../maplibre/loader'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  mapLibreCanvasSurfaceStateEquals,
  publishMapDiagnostics,
  type MapLibreCanvasSurfaceState,
} from '../../maplibre/canvas-surface-state'
import { toMapLibreSurfaceErrorMessage } from '../../maplibre/canvas-surface-errors'
import { applyTerrainPaintUpdates, classifyTerrainSync, clearTerrain, rebuildTerrain } from '../../maplibre/terrain-sync'
import {
  TERRAIN_CONTOUR_LAYER_IDS,
  TERRAIN_CONTOUR_SOURCE_ID,
  TERRAIN_DEM_SOURCE_ID,
  TERRAIN_HILLSHADE_LAYER_ID,
  type TerrainLayerState,
} from '../../maplibre/terrain'
import { mapErrorResourceId } from '../../maplibre/map-error-owner'
import type { RasterDisplay, RasterDisplayLayer } from '../../maplibre/raster-display/adapter'
import { clearCanvasMapSurfaceOverlays, syncCanvasMapSurfaceOverlays, type CanvasMapSurfaceOverlaySnapshot } from './overlays'
import { createMapLayerStackDescriptors, reconcileMapLayerStack } from '../map-layers/bands'
import { captureWorkspaceMapContributions, type WorkspaceMapContributionAdapter, type WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'

export interface WorkspaceMapContributionsOptions {
  readonly sessionIdentity: object
  readonly onFailure: (error: unknown) => void
  readonly loadTerrainSupport?: WorkspaceMapContributionAdapter['loadTerrainSupport']
  readonly createRasterDisplay?: WorkspaceMapContributionAdapter['createRasterDisplay']
  readonly publishViewBounds?: WorkspaceMapContributionAdapter['publishViewBounds']
  readonly onStateChange?: (state: MapLibreCanvasSurfaceState) => void
  readonly publishDiagnostics?: (frame: ViewDiagnostics | null) => void
  readonly logError?: (message?: unknown, ...args: unknown[]) => void
}

/** Map-lifetime presentation owner. It never creates a map or writes a camera. */
export class WorkspaceMapContributions {
  private snapshot: WorkspaceMapContributionSnapshot | null = null
  private context: MapLibreSurfaceContext<MapLibreMapInstance> | null = null
  private state = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE
  /** Map-lifetime owner of the upstream raster renderer (Desktop only). */
  private raster: RasterDisplay | null = null
  private terrain: TerrainLayerState | null = null
  private terrainTouched = false
  private terrainUnavailable = false
  private terrainGeneration = 0
  private revision = 0
  private styleReady = false
  private dirty = false
  private draining = false
  private failed = false
  private disposed = false
  /** Target set whose overlay failed; skipped until the Targets change. */
  private skippedOverlayKey: string | null = null
  private rasterSkipped = false
  private readonly removeListeners: Array<() => void> = []

  constructor(private readonly options: WorkspaceMapContributionsOptions) {}

  attach(context: MapLibreSurfaceContext<MapLibreMapInstance>): void {
    if (this.disposed) return
    this.context = context
    // The raster renderer adds its layers asynchronously after its module and
    // headers load; each change re-establishes the semantic band order.
    this.raster = this.options.createRasterDisplay?.(context.map, {
      onLayersChanged: () => this.reorderAfterRasterChange(),
    }) ?? null
    const publishBounds = () => {
      if (this.live() && this.styleReady && this.snapshot) this.publishBounds()
    }
    for (const event of ['moveend', 'resize'] as const) {
      context.map.on(event, publishBounds)
      this.removeListeners.push(() => context.map.off(event, publishBounds))
    }
    this.publishState({ ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'loading' })
  }

  update(snapshot: WorkspaceMapContributionSnapshot | null): void {
    if (this.disposed || this.failed || (snapshot && snapshot.sessionIdentity !== this.options.sessionIdentity)) return
    if (!snapshot || !this.snapshot || classifyTerrainSync(this.snapshot.terrain, snapshot.terrain) !== 'noop') {
      this.terrainUnavailable = false
    }
    this.snapshot = snapshot && captureWorkspaceMapContributions(snapshot)
    this.revision += 1
    this.terrainGeneration += 1
    this.dirty = true
    this.drain()
  }

  restoreStyle(): void {
    if (!this.live()) return
    this.styleReady = true
    this.revision += 1
    this.terrainGeneration += 1
    this.terrain = null
    this.terrainUnavailable = false
    this.dirty = true
    this.drain()
  }

  /**
   * Routes a MapLibre error that names a resource this owner contributed.
   * Contributions are optional: a failing one is skipped, logged and noticed,
   * and the map stays admitted. Returns false for anything it does not own.
   */
  handleMapError(event: unknown): boolean {
    const id = mapErrorResourceId(event)
    if (id === null || !this.live()) return id !== null && isContributionResource(id)
    if (/^mlrcog\d+-src-/.test(id) || this.raster?.layerIds().includes(id)) {
      // The upstream renderer draws a failed tile as transparent and keeps the
      // rest of the band; a source error is passive display degradation.
      this.log('Passive shared workspace raster error:', event)
      return true
    }
    if (TERRAIN_DEM_IDS.has(id) || TERRAIN_CONTOUR_IDS.has(id)) {
      const enabled = TERRAIN_DEM_IDS.has(id)
        ? this.snapshot?.terrain.hillshadeVisible
        : this.snapshot?.terrain.contoursVisible
      if (!enabled) return true
      this.revision += 1
      this.terrainGeneration += 1
      this.terrainUnavailable = true
      this.terrainFailed(event)
      return true
    }
    if (id.startsWith(PANEL_TARGET_PREFIX)) {
      // MapLibre validation emits instead of throwing, often mid-sync; the
      // drain removes the partial overlay on its next pass.
      if (this.skippedOverlayKey === null && this.snapshot) this.overlayFailed(overlayKey(this.snapshot.overlays), event)
      this.dirty = true
      this.drain()
      return true
    }
    return false
  }

  dispose(error?: unknown): void {
    if (this.disposed) return
    this.disposed = true
    this.revision += 1
    this.terrainGeneration += 1
    this.snapshot = null
    this.publishState({
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
      status: error ? 'error' : 'idle',
      errorMessage: error ? toMapLibreSurfaceErrorMessage(error) : null,
    })
    for (const remove of this.removeListeners.splice(0)) this.attempt('Failed to remove map contribution listener:', remove)
    this.clear()
    // Map-lifetime teardown: the manager's layers, sources, protocol and
    // listeners go, and its worker client rejects queued and in-flight work.
    const raster = this.raster
    this.raster = null
    this.attempt('Failed to dispose the raster display:', () => raster?.dispose())
    this.context = null
  }

  private live(): boolean {
    return !this.disposed && !this.failed && this.context?.isCurrent() === true
  }

  private drain(): void {
    if (this.draining || !this.live() || !this.styleReady) return
    this.draining = true
    try {
      while (this.dirty && this.live()) {
        this.dirty = false
        const snapshot = this.snapshot
        const revision = this.revision
        if (!snapshot) {
          this.publishState(IDLE_MAPLIBRE_CANVAS_SURFACE_STATE)
          this.clear()
          continue
        }
        // Synchronous callbacks may replace or dispose the session during any map mutation.
        const map = this.guardedMap(revision)
        try {
          this.syncRaster(map, snapshot.lidar)
          this.syncOverlays(map, snapshot.overlays)
          this.reconcileOrder(map, snapshot)
          this.publishState({ ...this.state, status: 'ready', errorMessage: null, layerSkipped: this.layerSkipped() })
          if (!this.current(revision)) continue
          this.publishBounds()
          if (!this.current(revision)) continue
          this.publishDiagnostics(snapshot.frame)
          if (!this.current(revision)) continue
          void this.syncTerrain(map, snapshot, revision)
        } catch (error) {
          if (error !== STALE_CONTRIBUTION) this.fail(error)
        }
      }
    } finally {
      this.draining = false
    }
  }

  /** Hand the desired band to the renderer, beneath the first higher Canopi layer. */
  private syncRaster(map: MapLibreMapInstance, layers: readonly Readonly<RasterDisplayLayer>[]): void {
    if (!this.raster) return
    const order = map.getLayersOrder()
    const anchor = createMapLayerStackDescriptors([])
      .filter((descriptor) => descriptor.band !== 'basemap')
      .map((descriptor) => descriptor.id)
      .find((id) => order.includes(id))
    try {
      this.raster.sync(layers, anchor)
      this.rasterSkipped = false
    } catch (error) {
      // Raster display is passive: a renderer that rejects the band never
      // disables editing or the other contributions.
      this.rasterSkipped = true
      this.log('Failed to sync the raster band:', error)
    }
  }

  /**
   * Panel Target overlays are optional decoration. A failing sync is rolled
   * back and skipped until the Targets change; a rollback that cannot remove
   * the partial overlay escapes to the hard failure path.
   */
  private syncOverlays(map: MapLibreMapInstance, overlays: CanvasMapSurfaceOverlaySnapshot): void {
    const key = overlayKey(overlays)
    if (this.skippedOverlayKey !== null) {
      if (this.skippedOverlayKey === key) {
        clearCanvasMapSurfaceOverlays(map)
        return
      }
      this.skippedOverlayKey = null
    }
    try {
      syncCanvasMapSurfaceOverlays(map, overlays, true)
    } catch (error) {
      if (error === STALE_CONTRIBUTION) throw error
      this.overlayFailed(key, error)
      clearCanvasMapSurfaceOverlays(map)
    }
  }

  private overlayFailed(key: string, error: unknown): void {
    this.skippedOverlayKey = key
    this.log('Skipped a map overlay that failed to sync:', error)
  }

  private layerSkipped(): boolean {
    return this.skippedOverlayKey !== null || this.rasterSkipped
  }

  /** The renderer changed map layers asynchronously; restore the semantic order. */
  private reorderAfterRasterChange(): void {
    if (!this.live() || !this.styleReady || !this.snapshot || this.draining) return
    const revision = this.revision
    try {
      this.reconcileOrder(this.guardedMap(revision), this.snapshot)
    } catch (error) {
      if (error !== STALE_CONTRIBUTION) this.fail(error)
    }
  }

  private async syncTerrain(map: MapLibreMapInstance, snapshot: WorkspaceMapContributionSnapshot, revision: number): Promise<void> {
    const generation = ++this.terrainGeneration
    const current = () => this.current(revision) && generation === this.terrainGeneration
    const next = snapshot.terrain
    if (this.terrainUnavailable) return
    let rebuilt = false
    try {
      const mode = classifyTerrainSync(this.terrain, next)
      if (mode === 'clear' || ((!next.contoursVisible && !next.hillshadeVisible) && this.terrainTouched)) {
        clearTerrain(map)
        this.terrain = null
        this.terrainTouched = false
      } else if (mode === 'paint') {
        applyTerrainPaintUpdates(map, next)
        this.terrain = next
      } else if (mode === 'rebuild') {
        this.publishState({ ...this.state, terrainStatus: 'loading', terrainErrorMessage: null })
        if (!current()) return
        if (!this.options.loadTerrainSupport) throw new Error('Terrain support is unavailable in this workspace.')
        const support = await this.options.loadTerrainSupport(this.context!.maplibre)
        if (!current()) return
        this.terrainTouched = true
        rebuildTerrain(map, support, next)
        if (!current()) return
        this.terrain = next
        rebuilt = true
      }
    } catch (error) {
      if (current() && error !== STALE_CONTRIBUTION) this.terrainFailed(error)
      return
    }
    if (!current()) return
    // Source/terrain failures are passive. The shared semantic stack is an
    // editing invariant, so ordering failure uses the hard map failure path.
    if (rebuilt) {
      try {
        this.reconcileOrder(map, this.snapshot!)
      } catch (error) {
        if (error !== STALE_CONTRIBUTION) this.fail(error)
        return
      }
    }
    if (current()) this.publishState({ ...this.state, terrainStatus: this.terrain ? 'ready' : 'idle', terrainErrorMessage: null })
  }

  private fail(error: unknown): void {
    if (this.disposed || this.failed) return
    this.failed = true
    try {
      // Let the map owner retain the original cause before cleanup callbacks
      // can synchronously emit a second error. The failure fence is already up.
      this.options.onFailure(error)
    } finally {
      this.dispose(error)
    }
  }

  private terrainFailed(error: unknown): void {
    this.terrainUnavailable = true
    const revision = this.revision
    try {
      if (this.context) clearTerrain(this.guardedMap(revision))
    } catch (cleanupError) {
      if (cleanupError !== STALE_CONTRIBUTION) this.fail(cleanupError)
      return
    }
    if (!this.current(revision)) return
    this.terrain = null
    this.publishState({ ...this.state, terrainStatus: 'error', terrainErrorMessage: toMapLibreSurfaceErrorMessage(error) })
    this.log('Failed to sync terrain layers:', error)
  }

  private reconcileOrder(map: MapLibreMapInstance, snapshot: WorkspaceMapContributionSnapshot): void {
    // Only layers the renderer has actually added take part; a layer still
    // loading its header is placed when it arrives.
    const present = this.raster?.layerIds() ?? []
    reconcileMapLayerStack(map, createMapLayerStackDescriptors(snapshot.lidar.map((layer) => layer.id).filter((id) => present.includes(id))))
  }

  private clear(): void {
    const revision = this.revision
    const map = this.context && this.guardedMap(revision, true)
    if (map) {
      this.attempt('Failed to clear map target overlays:', () => clearCanvasMapSurfaceOverlays(map))
      this.attempt('Failed to clear map terrain:', () => clearTerrain(map))
      this.attempt('Failed to clear map rasters:', () => this.raster?.sync([], undefined))
    }
    if (this.revision !== revision) return
    this.terrain = null
    this.terrainTouched = false
    this.attempt('Failed to clear map view bounds:', () => this.options.publishViewBounds?.(null))
    this.attempt('Failed to clear map diagnostics:', () => this.publishDiagnostics(null))
  }

  private current(revision: number): boolean {
    return this.live() && this.revision === revision
  }

  private guardedMap(revision: number, cleanup = false): MapLibreMapInstance {
    const ownedMap = this.context!.map
    const current = () => cleanup
      ? this.context?.map === ownedMap && this.revision === revision
      : this.current(revision)
    return new Proxy(ownedMap, {
      get: (map, property) => {
        const value = Reflect.get(map, property)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (!current()) throw STALE_CONTRIBUTION
          const result = Reflect.apply(value, map, args)
          if (!current()) throw STALE_CONTRIBUTION
          return result
        }
      },
    })
  }

  private publishBounds(): void {
    this.attempt('Map contribution bounds observer failed:', () => {
      const bounds = this.context?.map.getBounds?.()
      if (bounds) this.options.publishViewBounds?.([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()])
    })
  }

  private publishState(state: MapLibreCanvasSurfaceState): void {
    if (mapLibreCanvasSurfaceStateEquals(this.state, state)) return
    this.state = state
    this.attempt('Map contribution state observer failed:', () => this.options.onStateChange?.(state))
  }

  private publishDiagnostics(frame: ViewDiagnostics | null): void {
    this.attempt('Map contribution diagnostics observer failed:', () => {
      (this.options.publishDiagnostics ?? publishMapDiagnostics)(frame)
    })
  }

  private attempt(message: string, run: () => void): void {
    try { run() } catch (error) { if (error !== STALE_CONTRIBUTION) this.log(message, error) }
  }

  private log(message: string, error: unknown): void {
    (this.options.logError ?? logMapError)(message, error)
  }
}

const STALE_CONTRIBUTION = Symbol('stale-map-contribution')
const PANEL_TARGET_PREFIX = 'panel-target-'
const TERRAIN_DEM_IDS = new Set<string>([TERRAIN_DEM_SOURCE_ID, TERRAIN_HILLSHADE_LAYER_ID])
const TERRAIN_CONTOUR_IDS = new Set<string>([TERRAIN_CONTOUR_SOURCE_ID, ...TERRAIN_CONTOUR_LAYER_IDS])

/** Late errors from a contribution this owner already removed stay passive. */
function isContributionResource(id: string): boolean {
  return /^mlrcog\d+-/.test(id)
    || TERRAIN_DEM_IDS.has(id)
    || TERRAIN_CONTOUR_IDS.has(id)
    || id.startsWith(PANEL_TARGET_PREFIX)
}

/** Identity of the Target set an overlay draws; geometry is re-read on each sync. */
function overlayKey(overlays: CanvasMapSurfaceOverlaySnapshot): string {
  return JSON.stringify([overlays.hoveredTargets, overlays.selectedTargets])
}
