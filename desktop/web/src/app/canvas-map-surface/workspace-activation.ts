import { MAPLIBRE_SCENE_RENDERER_ID } from '../../canvas/runtime/renderers/maplibre-scene'
import { throwCanvasRuntimeCleanupErrors } from '../../canvas/runtime/cleanup'
import type { SceneCanvasRuntime } from '../../canvas/runtime/scene-runtime'
import type { MapLibreMapInstance } from '../../maplibre/loader'
import type { WorkspaceMapSnapshot } from '../../maplibre/workspace-map'
import {
  MAPLIBRE_SHARED_SCENE_LAYER_ID,
  type SharedMapSceneLayer,
  type SharedMapSceneLayerOptions,
  type SharedMapSceneMap,
} from '../../maplibre/shared-scene-layer'
import type { SharedMapSceneRendererComposition } from '../../maplibre/shared-scene-renderer'
import {
  type MapLibreWorkspaceCameraMap,
  type MapLibreWorkspaceCameraFailure,
  type MapLibreWorkspaceCameraOwner,
} from '../../maplibre/workspace-camera'

export type WorkspaceActivationOutcome = 'shared-ready' | 'fallback-ready' | 'cancelled'

/** One immutable Design/map generation input. Session identity is compared only by ownership. */
export interface WorkspaceActivationSnapshot {
  readonly sessionIdentity: object
  readonly map: WorkspaceMapSnapshot
  readonly maximumWorldExtentMeters?: number
}

/** One map that is suitable for both the shared graphics layer and camera owner. */
export type WorkspaceActivationMap = MapLibreWorkspaceCameraMap & Pick<
  MapLibreMapInstance,
  | 'addLayer'
  | 'addSource'
  | 'getSource'
  | 'getLayer'
  | 'getLayersOrder'
  | 'moveLayer'
  | 'setPaintProperty'
>

export interface WorkspaceActivationMapControls {
  createMap(
    signal: AbortSignal,
    snapshot: WorkspaceMapSnapshot,
  ): Promise<WorkspaceActivationMap>
  releaseMap(map: WorkspaceActivationMap): void
  getWebGL2Context(map: WorkspaceActivationMap): WebGL2RenderingContext | null
  /** Restores same-map style contributions after initial style admission. */
  installStyleRestorer(map: WorkspaceActivationMap, restore: () => void): () => void
  /** Map/context failures that happen outside the custom layer. */
  watchFailure?(
    map: WorkspaceActivationMap,
    reportFailure: (error: unknown) => void,
  ): () => void
}

export interface WorkspaceActivationRuntime {
  init(container: HTMLElement): Promise<void>
  reportRendererFailure(id: string, error: unknown): Promise<void>
  destroy(): void
}

export interface WorkspaceActivationOptions {
  readonly container: HTMLElement
  readonly runtime: WorkspaceActivationRuntime | SceneCanvasRuntime
  readonly camera: MapLibreWorkspaceCameraOwner
  readonly composition: SharedMapSceneRendererComposition
  readonly map: WorkspaceActivationMapControls
  readonly layer: Omit<
    SharedMapSceneLayerOptions,
    'id' | 'anchor' | 'northBearingDeg' | 'maximumWorldExtentMeters' | 'onFailure'
  >
}

interface ActivationGeneration {
  readonly id: number
  readonly snapshot: WorkspaceActivationSnapshot
  map: WorkspaceActivationMap | null
  layer: SharedMapSceneLayer | null
  disposeStyleRestorer: (() => void) | null
  unwatchFailure: (() => void) | null
  unsubscribeCameraFailure: (() => void) | null
  cameraAttached: boolean
  cancelled: boolean
  cleanupResult: Promise<void> | null
  failure: Promise<WorkspaceActivationOutcome> | null
  readonly abortController: AbortController
}

/**
 * Transactionally admits map-owned scene rendering. It is deliberately not
 * mounted by either edition yet: production composition still uses the default
 * Pixi/Canvas2D renderer path until input and workspace lifetime migration are complete.
 */
export class WorkspaceActivationCoordinator {
  private generation = 0
  private activationRequest = 0
  private active: ActivationGeneration | null = null
  private cleanupInFlight: Promise<void> | null = null
  private runtimeInit: Promise<void> | null = null
  private runtimeInitialized = false
  private runtimeDestroyed = false
  private sharedBackendTerminal = false
  private disposed = false

  constructor(private readonly options: WorkspaceActivationOptions) {}

  async activate(snapshot: WorkspaceActivationSnapshot): Promise<WorkspaceActivationOutcome> {
    const ownedSnapshot = captureActivationSnapshot(snapshot)
    if (this.disposed) return 'cancelled'
    const request = ++this.activationRequest
    try {
      await this.cleanupActiveGeneration()
    } catch (error) {
      if (request !== this.activationRequest || this.disposed) return 'cancelled'
      throw error
    }
    if (request !== this.activationRequest || this.disposed) return 'cancelled'
    if (this.sharedBackendTerminal) return 'fallback-ready'
    const current: ActivationGeneration = {
      id: ++this.generation,
      snapshot: ownedSnapshot,
      map: null,
      layer: null,
      disposeStyleRestorer: null,
      unwatchFailure: null,
      unsubscribeCameraFailure: null,
      cameraAttached: false,
      cancelled: false,
      cleanupResult: null,
      failure: null,
      abortController: new AbortController(),
    }
    this.active = current

    let sharedRuntimeInitializationFailed = false
    try {
      const map = await this.options.map.createMap(
        current.abortController.signal,
        current.snapshot.map,
      )
      if (!this.isCurrent(current)) {
        this.releaseStaleMap(map)
        return 'cancelled'
      }
      current.map = map
      current.unwatchFailure = this.options.map.watchFailure?.(map, (error) => {
        this.observeFailure(current, error)
      }) ?? null
      if (current.failure) return current.failure

      const context = this.options.map.getWebGL2Context(map)
      if (!context) throw new Error('MapLibre did not expose a WebGL2 context for shared rendering.')

      const layer = this.options.composition.createLayer({
        ...this.options.layer,
        id: MAPLIBRE_SHARED_SCENE_LAYER_ID,
        anchor: current.snapshot.map.anchor,
        northBearingDeg: current.snapshot.map.northBearingDeg,
        maximumWorldExtentMeters: current.snapshot.maximumWorldExtentMeters,
        onFailure: (error) => {
          this.observeFailure(current, error)
        },
      })
      current.layer = layer
      await layer.initialize(map as unknown as SharedMapSceneMap, context)
      if (!this.isCurrent(current)) return 'cancelled'
      if (current.failure) return current.failure

      current.disposeStyleRestorer = this.options.map.installStyleRestorer(
        map,
        () => this.restoreSharedSceneLayer(current, map, layer),
      )
      if (current.failure) return current.failure
      this.restoreSharedSceneLayer(current, map, layer)
      if (current.failure) return current.failure

      current.unsubscribeCameraFailure = this.options.camera.attachment.subscribeFailure(
        (failure) => this.observeFailure(current, cameraFailureError(failure)),
      )
      const attached = this.options.camera.attachment.attach({
        map,
        anchor: current.snapshot.map.anchor,
        northBearingDeg: current.snapshot.map.northBearingDeg,
        maximumWorldExtentMeters: current.snapshot.maximumWorldExtentMeters,
      })
      if (!attached) throw new Error('MapLibre workspace camera rejected the shared map attachment.')
      current.cameraAttached = true
      if (current.failure) return current.failure

      const runtimeInit = this.initializeRuntime()
      try {
        await runtimeInit
      } catch (error) {
        if (!this.isCurrent(current)) return 'cancelled'
        if (current.failure) return current.failure
        sharedRuntimeInitializationFailed = true
        const errors: unknown[] = [error]
        this.sharedBackendTerminal = true
        this.destroyRuntime(errors)
        try {
          await this.cleanup(current)
        } catch (cleanupError) {
          errors.push(cleanupError)
        }
        throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace renderer initialization failed')
      }
      if (!this.isCurrent(current)) {
        return 'cancelled'
      }
      this.runtimeInitialized = true
      return current.failure ?? 'shared-ready'
    } catch (error) {
      if (!this.isCurrent(current)) return 'cancelled'
      if (sharedRuntimeInitializationFailed) throw error
      return this.reportFailureFor(current, error)
    }
  }

  /** Allows the map host to report context loss without exposing runtime internals to UI code. */
  reportFailure(error: unknown): Promise<WorkspaceActivationOutcome> {
    const current = this.active
    return current ? this.reportFailureFor(current, error) : Promise.resolve('cancelled')
  }

  async teardown(): Promise<void> {
    if (this.disposed && this.runtimeDestroyed) return
    this.disposed = true
    ++this.activationRequest
    const errors: unknown[] = []
    try {
      await this.cleanupActiveGeneration()
    } catch (error) {
      errors.push(error)
    }
    if (this.runtimeInit) {
      try {
        await this.runtimeInit
      } catch (error) {
        errors.push(error)
      }
    }
    this.destroyRuntime(errors)
    throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace teardown failed')
  }

  private cleanupActiveGeneration(): Promise<void> {
    if (this.cleanupInFlight) return this.cleanupInFlight
    const current = this.active
    if (!current) return Promise.resolve()
    this.active = null
    current.cancelled = true
    ++this.generation
    let tracked!: Promise<void>
    tracked = Promise.resolve().then(async () => {
      const errors: unknown[] = []
      try {
        await this.cleanup(current)
      } catch (error) {
        errors.push(error)
      }
      if (current.failure) {
        try {
          await current.failure
        } catch (error) {
          errors.push(error)
        }
      }
      throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace teardown failed')
    }).then(
      () => {
        if (this.cleanupInFlight === tracked) this.cleanupInFlight = null
      },
      (error: unknown) => {
        if (this.cleanupInFlight === tracked) this.cleanupInFlight = null
        throw error
      },
    )
    this.cleanupInFlight = tracked
    // Publish the shared cleanup transaction before aborting acquisition.
    // Abort listeners are external code and may reenter activate/teardown.
    current.abortController.abort()
    return tracked
  }

  private reportFailureFor(
    current: ActivationGeneration,
    error: unknown,
  ): Promise<WorkspaceActivationOutcome> {
    if (!this.isCurrent(current)) return Promise.resolve('cancelled')
    if (current.failure) return current.failure

    // Install the failure fence before invoking composition, runtime, or
    // cleanup code. Those boundaries may synchronously report another failure.
    current.failure = Promise.resolve().then(() => {
      if (!this.isCurrent(current)) return 'cancelled'
      this.sharedBackendTerminal = true
      return this.runtimeInitialized
        ? this.failActiveRenderer(current, error)
        : this.runtimeInit
          ? this.failWhileRuntimeInitializes(current, error)
          : this.failAdmission(current, error)
    })
    return current.failure
  }

  private async failAdmission(
    current: ActivationGeneration,
    error: unknown,
  ): Promise<WorkspaceActivationOutcome> {
    this.options.composition.failActiveLayer(error)
    const errors: unknown[] = []
    try {
      await this.cleanup(current)
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    if (!this.isCurrent(current)) return 'cancelled'

    try {
      await this.initializeRuntime()
    } catch (initializationError) {
      if (!this.isCurrent(current)) return 'cancelled'
      errors.push(initializationError)
      this.destroyRuntime(errors)
      throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace renderer initialization failed')
    }
    if (!this.isCurrent(current)) {
      return 'cancelled'
    }
    this.runtimeInitialized = true
    throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace admission cleanup failed')
    return 'fallback-ready'
  }

  private async failActiveRenderer(
    current: ActivationGeneration,
    error: unknown,
  ): Promise<WorkspaceActivationOutcome> {
    this.options.composition.failActiveLayer(error)
    // Begin failover before cleanup, then retain map context long enough for
    // custom-layer graphics destruction. The scheduler republishes the full
    // current Scene through Canvas2D before this promise settles.
    const replacement = Promise.resolve().then(() => this.options.runtime.reportRendererFailure(
      MAPLIBRE_SCENE_RENDERER_ID,
      error,
    ))
    const errors: unknown[] = []
    try {
      await this.cleanup(current)
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    try {
      await replacement
    } catch (replacementError) {
      if (!this.isCurrent(current)) return 'cancelled'
      errors.push(replacementError)
    }
    if (!this.isCurrent(current)) return 'cancelled'
    throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace renderer failover failed')
    return 'fallback-ready'
  }

  private async failWhileRuntimeInitializes(
    current: ActivationGeneration,
    error: unknown,
  ): Promise<WorkspaceActivationOutcome> {
    this.options.composition.failActiveLayer(error)
    const errors: unknown[] = []
    try {
      await this.cleanup(current)
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    try {
      await this.runtimeInit
    } catch (initializationError) {
      if (!this.isCurrent(current)) return 'cancelled'
      errors.push(initializationError)
      this.destroyRuntime(errors)
      throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace renderer initialization failed')
    }
    if (!this.isCurrent(current)) return 'cancelled'
    this.runtimeInitialized = true
    try {
      await this.options.runtime.reportRendererFailure(MAPLIBRE_SCENE_RENDERER_ID, error)
    } catch (replacementError) {
      if (!this.isCurrent(current)) return 'cancelled'
      errors.push(replacementError)
    }
    if (!this.isCurrent(current)) return 'cancelled'
    throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace renderer failover failed')
    return 'fallback-ready'
  }

  private cleanup(current: ActivationGeneration): Promise<void> {
    if (current.cleanupResult) return current.cleanupResult
    // Defer cleanup until after the promise is installed. Disposers are
    // external code and may synchronously report another workspace failure.
    current.cleanupResult = Promise.resolve().then(() => this.cleanupResources(current))
    return current.cleanupResult
  }

  private async cleanupResources(current: ActivationGeneration): Promise<void> {
    const errors: unknown[] = []
    const unwatchFailure = current.unwatchFailure
    current.unwatchFailure = null
    const unsubscribeCameraFailure = current.unsubscribeCameraFailure
    current.unsubscribeCameraFailure = null
    const disposeStyleRestorer = current.disposeStyleRestorer
    current.disposeStyleRestorer = null
    try {
      disposeStyleRestorer?.()
    } catch (error) {
      errors.push(error)
    }
    try {
      unwatchFailure?.()
    } catch (error) {
      errors.push(error)
    }
    try {
      unsubscribeCameraFailure?.()
    } catch (error) {
      errors.push(error)
    }
    if (current.cameraAttached) {
      current.cameraAttached = false
      try {
        this.options.camera.attachment.detach()
      } catch (error) {
        errors.push(error)
      }
    }
    const layer = current.layer
    current.layer = null
    try {
      await layer?.dispose({ mapWillBeRemoved: true })
    } catch (error) {
      errors.push(error)
    }
    const map = current.map
    current.map = null
    try {
      if (map) this.options.map.releaseMap(map)
    } catch (error) {
      errors.push(error)
    }
    throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace resource cleanup failed')
  }

  private observeFailure(current: ActivationGeneration, error: unknown): void {
    void this.reportFailureFor(current, error).catch((failure) => {
      if (this.isCurrent(current)) {
        console.error('Shared workspace callback failover failed:', failure)
      }
    })
  }

  private restoreSharedSceneLayer(
    current: ActivationGeneration,
    map: WorkspaceActivationMap,
    layer: SharedMapSceneLayer,
  ): void {
    if (!this.isCurrent(current) || current.layer !== layer || current.map !== map) return
    if (map.getLayer(MAPLIBRE_SHARED_SCENE_LAYER_ID) == null) {
      map.addLayer(layer.layer as unknown as Record<string, unknown>)
    }
    if (layer.diagnostics.phase !== 'attached') {
      throw new Error('MapLibre did not attach the initialized shared scene layer.')
    }
  }

  private initializeRuntime(): Promise<void> {
    // Record the pending transaction before runtime code runs so a synchronous
    // throw cannot be mistaken for a pre-admission map failure and retried.
    if (!this.runtimeInit) {
      this.runtimeInit = Promise.resolve().then(
        () => this.options.runtime.init(this.options.container),
      )
    }
    return this.runtimeInit
  }

  private destroyRuntime(errors: unknown[]): void {
    if (!this.runtimeInit || this.runtimeDestroyed) return
    this.runtimeDestroyed = true
    try {
      this.options.runtime.destroy()
    } catch (error) {
      errors.push(error)
    }
  }

  private releaseStaleMap(map: WorkspaceActivationMap): void {
    try {
      this.options.map.releaseMap(map)
    } catch (error) {
      console.error('Failed to release stale MapLibre workspace map:', error)
    }
  }

  private isCurrent(current: ActivationGeneration): boolean {
    return !current.cancelled && this.active === current && this.generation === current.id
  }
}

function captureActivationSnapshot(
  snapshot: WorkspaceActivationSnapshot,
): WorkspaceActivationSnapshot {
  const map = captureMapSnapshot(snapshot.map)
  return Object.freeze({
    sessionIdentity: snapshot.sessionIdentity,
    map,
    maximumWorldExtentMeters: snapshot.maximumWorldExtentMeters,
  })
}

function captureMapSnapshot(snapshot: WorkspaceMapSnapshot): WorkspaceMapSnapshot {
  return Object.freeze({
    anchor: Object.freeze({
      lat: snapshot.anchor.lat,
      lon: snapshot.anchor.lon,
    }),
    northBearingDeg: snapshot.northBearingDeg,
    placementStatus: snapshot.placementStatus,
    basemapStyle: snapshot.basemapStyle,
    basemapVisible: snapshot.basemapVisible,
    basemapOpacity: snapshot.basemapOpacity,
  })
}

function cameraFailureError(failure: MapLibreWorkspaceCameraFailure): Error {
  if (failure.kind === 'attachment-error' && failure.error instanceof Error) return failure.error
  return new Error(
    failure.kind === 'invalid-projection'
      ? `MapLibre workspace camera rejected its projection: ${failure.reason}.`
      : 'MapLibre workspace camera attachment failed.',
  )
}
