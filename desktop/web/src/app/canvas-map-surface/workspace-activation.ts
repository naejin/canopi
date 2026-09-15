import { MAPLIBRE_SCENE_RENDERER_ID } from '../../canvas/runtime/renderers/maplibre-scene'
import { throwCanvasRuntimeCleanupErrors } from '../../canvas/runtime/cleanup'
import type { SceneCanvasRuntime } from '../../canvas/runtime/scene-runtime'
import type { MapLibreMapInstance } from '../../maplibre/loader'
import {
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

/** One map that is suitable for both the shared graphics layer and camera owner. */
export type WorkspaceActivationMap = MapLibreWorkspaceCameraMap & Pick<
  MapLibreMapInstance,
  'addLayer' | 'remove'
>

export interface WorkspaceActivationMapControls {
  createMap(): Promise<WorkspaceActivationMap>
  getWebGL2Context(map: WorkspaceActivationMap): WebGL2RenderingContext | null
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
  readonly layer: Omit<SharedMapSceneLayerOptions, 'onFailure'>
}

interface ActivationGeneration {
  readonly id: number
  map: WorkspaceActivationMap | null
  layer: SharedMapSceneLayer | null
  unwatchFailure: (() => void) | null
  unsubscribeCameraFailure: (() => void) | null
  cameraAttached: boolean
  runtimeInit: Promise<void> | null
  runtimeInitialized: boolean
  runtimeDestroyed: boolean
  cancelled: boolean
  cleanupResult: Promise<void> | null
  failure: Promise<WorkspaceActivationOutcome> | null
}

/**
 * Transactionally admits map-owned scene rendering. It is deliberately not
 * mounted by either edition yet: production composition still uses the default
 * Pixi/Canvas2D renderer path until input and workspace lifetime migration are complete.
 */
export class WorkspaceActivationCoordinator {
  private generation = 0
  private active: ActivationGeneration | null = null

  constructor(private readonly options: WorkspaceActivationOptions) {}

  async activate(): Promise<WorkspaceActivationOutcome> {
    if (this.active) await this.teardown()
    const current: ActivationGeneration = {
      id: ++this.generation,
      map: null,
      layer: null,
      unwatchFailure: null,
      unsubscribeCameraFailure: null,
      cameraAttached: false,
      runtimeInit: null,
      runtimeInitialized: false,
      runtimeDestroyed: false,
      cancelled: false,
      cleanupResult: null,
      failure: null,
    }
    this.active = current

    let sharedRuntimeInitializationFailed = false
    try {
      const map = await this.options.map.createMap()
      if (!this.isCurrent(current)) {
        this.removeStaleMap(map)
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
        onFailure: (error) => {
          this.observeFailure(current, error)
        },
      })
      current.layer = layer
      await layer.initialize(map as unknown as SharedMapSceneMap, context)
      if (!this.isCurrent(current)) return 'cancelled'
      if (current.failure) return current.failure

      map.addLayer(layer.layer as unknown as Record<string, unknown>)
      if (layer.diagnostics.phase !== 'attached') {
        throw new Error('MapLibre did not attach the initialized shared scene layer.')
      }

      current.unsubscribeCameraFailure = this.options.camera.attachment.subscribeFailure(
        (failure) => this.observeFailure(current, cameraFailureError(failure)),
      )
      const attached = this.options.camera.attachment.attach({
        map,
        anchor: this.options.layer.anchor,
        northBearingDeg: this.options.layer.northBearingDeg,
        maximumWorldExtentMeters: this.options.layer.maximumWorldExtentMeters,
      })
      if (!attached) throw new Error('MapLibre workspace camera rejected the shared map attachment.')
      current.cameraAttached = true
      if (current.failure) return current.failure

      const runtimeInit = this.initializeRuntime(current)
      try {
        await runtimeInit
      } catch (error) {
        if (!this.isCurrent(current)) return 'cancelled'
        if (current.failure) return current.failure
        sharedRuntimeInitializationFailed = true
        const errors: unknown[] = [error]
        this.destroyRuntime(current, errors)
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
      current.runtimeInitialized = true
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
    const current = this.active
    if (!current) return
    this.active = null
    current.cancelled = true
    ++this.generation
    const errors: unknown[] = []
    this.destroyRuntime(current, errors)
    try {
      await this.cleanup(current)
    } catch (error) {
      errors.push(error)
    }
    throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace teardown failed')
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
      return current.runtimeInitialized
        ? this.failActiveRenderer(current, error)
        : current.runtimeInit
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
      await this.initializeRuntime(current)
    } catch (initializationError) {
      if (!this.isCurrent(current)) return 'cancelled'
      errors.push(initializationError)
      this.destroyRuntime(current, errors)
      throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace renderer initialization failed')
    }
    if (!this.isCurrent(current)) {
      return 'cancelled'
    }
    current.runtimeInitialized = true
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
      await current.runtimeInit
    } catch (initializationError) {
      if (!this.isCurrent(current)) return 'cancelled'
      errors.push(initializationError)
      this.destroyRuntime(current, errors)
      throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace renderer initialization failed')
    }
    if (!this.isCurrent(current)) return 'cancelled'
    current.runtimeInitialized = true
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
      map?.remove()
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

  private initializeRuntime(current: ActivationGeneration): Promise<void> {
    // Record the pending transaction before runtime code runs so a synchronous
    // throw cannot be mistaken for a pre-admission map failure and retried.
    if (!current.runtimeInit) {
      current.runtimeInit = Promise.resolve().then(
        () => this.options.runtime.init(this.options.container),
      )
    }
    return current.runtimeInit
  }

  private destroyRuntime(current: ActivationGeneration, errors: unknown[]): void {
    if (!current.runtimeInit || current.runtimeDestroyed) return
    current.runtimeDestroyed = true
    try {
      this.options.runtime.destroy()
    } catch (error) {
      errors.push(error)
    }
  }

  private removeStaleMap(map: WorkspaceActivationMap): void {
    try {
      map.remove()
    } catch (error) {
      console.error('Failed to remove stale MapLibre workspace map:', error)
    }
  }

  private isCurrent(current: ActivationGeneration): boolean {
    return !current.cancelled && this.active === current && this.generation === current.id
  }
}

function cameraFailureError(failure: MapLibreWorkspaceCameraFailure): Error {
  if (failure.kind === 'attachment-error' && failure.error instanceof Error) return failure.error
  return new Error(
    failure.kind === 'invalid-projection'
      ? `MapLibre workspace camera rejected its projection: ${failure.reason}.`
      : 'MapLibre workspace camera attachment failed.',
  )
}
