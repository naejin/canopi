import { captureWorkspaceMapContributions, type WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'
import { throwCanvasRuntimeCleanupErrors } from '../../canvas/runtime/cleanup'
import type { SceneCanvasRuntime } from '../../canvas/runtime/scene-runtime'
import type { MapLibreMapInstance } from '../../maplibre/loader'
import {
  type WorkspaceMapSnapshot,
} from '../../maplibre/workspace-map'
import {
  captureMapBackgroundPresentation,
  type MapBackgroundPresentation,
} from '../../maplibre/map-background'
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
import { createWorkspaceCameraPolicy } from '../../canvas/workspace-camera-policy'

/**
 * `map-unavailable`: WebGL2 or MapLibre could not start or failed later. No
 * renderer is mounted and the map surface publishes its error state (ADR 0004).
 */
export type WorkspaceActivationOutcome = 'shared-ready' | 'map-unavailable' | 'cancelled'

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
  | 'removeSource'
  | 'removeLayer'
  | 'getLayersOrder'
  | 'moveLayer'
  | 'setPaintProperty'
>

export interface WorkspaceActivationMapControls {
  createMap(
    signal: AbortSignal,
    snapshot: WorkspaceMapSnapshot,
    sessionIdentity: object,
  ): Promise<WorkspaceActivationMap>
  releaseMap(map: WorkspaceActivationMap, failure?: unknown): void
  getWebGL2Context(map: WorkspaceActivationMap): WebGL2RenderingContext | null
  updateMapContributions(snapshot: WorkspaceMapContributionSnapshot | null): void
  updateBackgroundPresentation(presentation: MapBackgroundPresentation): void
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
  /** Releases the renderer and editing after a map failure; the Scene stays loaded. */
  unmountRenderer(): Promise<void>
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
    'id' | 'readOrigin' | 'maximumWorldExtentMeters' | 'onFailure'
  >
  /** Live session plane origin of the runtime's open Design. */
  readonly readOrigin: () => { readonly lat: number; readonly lon: number }
}

interface ActivationGeneration {
  readonly id: number
  readonly snapshot: WorkspaceActivationSnapshot
  presentation: MapBackgroundPresentation
  map: WorkspaceActivationMap | null
  layer: SharedMapSceneLayer | null
  disposeStyleRestorer: (() => void) | null
  unwatchFailure: (() => void) | null
  unsubscribeCameraFailure: (() => void) | null
  cameraAttached: boolean
  cancelled: boolean
  cleanupResult: Promise<void> | null
  cleanupStarted: boolean
  finishCleanup: ((errors: unknown[]) => void) | null
  setupResult: Promise<void> | null
  failure: Promise<WorkspaceActivationOutcome> | null
  terminalMapFailure?: unknown
  readonly abortController: AbortController
}

interface PendingBackgroundPresentation {
  readonly request: number
  readonly presentation: MapBackgroundPresentation
  readonly hasUpdate: boolean
}

/** Transactionally admits production map-owned scene rendering. */
export class WorkspaceActivationCoordinator {
  private contributions: WorkspaceMapContributionSnapshot | null = null
  private generation = 0
  private activationRequest = 0
  private pendingBackgroundPresentation: PendingBackgroundPresentation | null = null
  private active: ActivationGeneration | null = null
  /**
   * The most recently requested generation cleanup remains observable after it
   * settles. A rejected cleanup deliberately rejects one successor admission;
   * that successor consumes the failure so a later explicit activation can
   * retry rather than silently admitting a map after an unobserved teardown.
   */
  private retainedCleanup: Promise<void> | null = null
  private ownedCallbackDepth = 0
  private readonly ownedReentryResults = new WeakSet<Promise<unknown>>()
  private readonly observedOwnedReentryResults = new WeakSet<Promise<unknown>>()
  private terminalTeardownResult: Promise<void> | null = null
  private terminalTeardownStarted = false
  private runtimeInit: Promise<void> | null = null
  private runtimeInitialized = false
  private runtimeDestroyed = false
  private mapUnavailable = false
  private disposed = false

  constructor(private readonly options: WorkspaceActivationOptions) {}

  activate(snapshot: WorkspaceActivationSnapshot): Promise<WorkspaceActivationOutcome> {
    const activation = this.activateGeneration(snapshot)
    this.recordOwnedReentry(activation)
    return activation
  }

  private async activateGeneration(
    snapshot: WorkspaceActivationSnapshot,
  ): Promise<WorkspaceActivationOutcome> {
    const ownedSnapshot = captureActivationSnapshot(snapshot)
    if (this.disposed) return 'cancelled'
    const request = ++this.activationRequest
    this.pendingBackgroundPresentation = {
      request,
      presentation: ownedSnapshot.map.background,
      hasUpdate: false,
    }
    const priorCleanup = this.cleanupActiveGeneration()
    try {
      await priorCleanup
    } catch (error) {
      if (request !== this.activationRequest || this.disposed) return 'cancelled'
      if (this.retainedCleanup === priorCleanup) this.retainedCleanup = null
      throw error
    }
    if (request !== this.activationRequest || this.disposed) return 'cancelled'
    this.options.camera.replacePolicy(createWorkspaceCameraPolicy(this.options.readOrigin().lat))
    if (this.mapUnavailable) return 'map-unavailable'
    const current: ActivationGeneration = {
      id: ++this.generation,
      snapshot: ownedSnapshot,
      presentation: this.pendingPresentationFor(request, ownedSnapshot.map),
      map: null,
      layer: null,
      disposeStyleRestorer: null,
      unwatchFailure: null,
      unsubscribeCameraFailure: null,
      cameraAttached: false,
      cancelled: false,
      cleanupResult: null,
      cleanupStarted: false,
      finishCleanup: null,
      setupResult: null,
      failure: null,
      abortController: new AbortController(),
    }
    this.active = current

    let sharedRuntimeInitializationFailed = false
    try {
      const finishMapCreation = this.beginSetup(current)
      let mapPromise: Promise<WorkspaceActivationMap>
      try {
        mapPromise = this.runOwnedCallback(
          'map creation',
          () => this.options.map.createMap(
            current.abortController.signal,
            current.snapshot.map,
            current.snapshot.sessionIdentity,
          ),
        )
      } finally {
        finishMapCreation()
      }
      this.flushPendingPresentation(current, request)
      if (this.isCurrent(current) && this.contributions?.sessionIdentity === current.snapshot.sessionIdentity) {
        this.options.map.updateMapContributions(this.contributions)
      }
      const map = await mapPromise
      if (!this.isCurrent(current)) {
        this.releaseStaleMap(map)
        return 'cancelled'
      }
      current.map = map
      if (this.options.map.watchFailure) {
        const finishFailureWatcher = this.beginSetup(current)
        let unwatchFailure: () => void
        try {
          unwatchFailure = this.runOwnedCallback(
            'map failure watcher installation',
            () => this.options.map.watchFailure!(map, (error) => {
              this.observeFailure(current, error)
            }),
          )
        } catch (error) {
          finishFailureWatcher()
          throw error
        }
        current.unwatchFailure = unwatchFailure
        finishFailureWatcher()
        if (!this.isCurrent(current)) return 'cancelled'
      }
      if (current.failure) return current.failure

      const finishContextAcquisition = this.beginSetup(current)
      let context: WebGL2RenderingContext | null
      try {
        context = this.runOwnedCallback(
          'WebGL2 context acquisition',
          () => this.options.map.getWebGL2Context(map),
        )
      } catch (error) {
        finishContextAcquisition()
        throw error
      }
      finishContextAcquisition()
      if (!this.isCurrent(current)) return 'cancelled'
      if (!context) throw new Error('MapLibre did not expose a WebGL2 context for shared rendering.')

      const finishLayerCreation = this.beginSetup(current)
      let layer: SharedMapSceneLayer
      try {
        layer = this.runOwnedCallback(
          'shared scene layer creation',
          () => this.options.composition.createLayer({
            ...this.options.layer,
            id: MAPLIBRE_SHARED_SCENE_LAYER_ID,
            readOrigin: this.options.readOrigin,
            maximumWorldExtentMeters: current.snapshot.maximumWorldExtentMeters,
            onFailure: (error) => {
              this.observeFailure(current, error)
            },
          }),
        )
      } catch (error) {
        finishLayerCreation()
        throw error
      }
      current.layer = layer
      finishLayerCreation()
      if (!this.isCurrent(current)) return 'cancelled'
      await this.runOwnedCallback(
        'shared scene layer initialization',
        () => layer.initialize(map as unknown as SharedMapSceneMap, context),
      )
      if (!this.isCurrent(current)) return 'cancelled'
      if (current.failure) return current.failure

      const finishStyleRestorer = this.beginSetup(current)
      let disposeStyleRestorer: () => void
      try {
        disposeStyleRestorer = this.runOwnedCallback(
          'style restorer installation',
          () => this.options.map.installStyleRestorer(
            map,
            () => this.restoreSharedSceneLayer(current, map, layer),
          ),
        )
      } catch (error) {
        finishStyleRestorer()
        throw error
      }
      current.disposeStyleRestorer = disposeStyleRestorer
      finishStyleRestorer()
      if (!this.isCurrent(current)) return 'cancelled'
      if (current.failure) return current.failure
      this.restoreSharedSceneLayer(current, map, layer)
      if (!this.isCurrent(current)) return 'cancelled'
      if (current.failure) return current.failure

      const finishCameraFailureSubscription = this.beginSetup(current)
      let unsubscribeCameraFailure: () => void
      try {
        unsubscribeCameraFailure = this.runOwnedCallback(
          'camera failure subscription',
          () => this.options.camera.attachment.subscribeFailure(
            (failure) => this.observeFailure(current, cameraFailureError(failure)),
          ),
        )
      } catch (error) {
        finishCameraFailureSubscription()
        throw error
      }
      current.unsubscribeCameraFailure = unsubscribeCameraFailure
      finishCameraFailureSubscription()
      if (!this.isCurrent(current)) return 'cancelled'

      // Mark the attachment before calling into the camera. attach() may
      // publish synchronously and trigger document replacement; that cleanup
      // must detach this pre-admitted attachment before attach() returns.
      current.cameraAttached = true
      const finishCameraAttachment = this.beginSetup(current)
      let attached: boolean
      try {
        attached = this.runOwnedCallback(
          'camera attachment',
          () => this.options.camera.attachment.attach({
            map,
            readOrigin: this.options.readOrigin,
            maximumWorldExtentMeters: current.snapshot.maximumWorldExtentMeters,
          }),
        )
      } catch (error) {
        if (current.cameraAttached) current.cameraAttached = false
        finishCameraAttachment()
        throw error
      }
      if (!attached) current.cameraAttached = false
      finishCameraAttachment()
      if (!this.isCurrent(current)) return 'cancelled'
      if (!attached) throw new Error('MapLibre workspace camera rejected the shared map attachment.')
      if (current.failure) return current.failure

      const runtimeInit = this.initializeRuntime()
      try {
        await runtimeInit
      } catch (error) {
        if (!this.isCurrent(current)) return 'cancelled'
        if (current.failure) return current.failure
        sharedRuntimeInitializationFailed = true
        current.terminalMapFailure = error
        const errors: unknown[] = [error]
        this.mapUnavailable = true
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

  updateMapContributions(snapshot: WorkspaceMapContributionSnapshot | null): void {
    if (this.disposed || this.mapUnavailable || this.terminalTeardownResult) return
    this.contributions = snapshot && captureWorkspaceMapContributions(snapshot)
    const current = this.active
    if (!current || !this.isCurrent(current)) return
    if (snapshot && snapshot.sessionIdentity !== current.snapshot.sessionIdentity) return
    this.options.map.updateMapContributions(this.contributions)
  }

  updateBackgroundPresentation(presentation: MapBackgroundPresentation): void {
    const next = captureMapBackgroundPresentation(presentation)
    if (this.disposed || this.mapUnavailable || this.terminalTeardownResult) return
    const pending = this.pendingBackgroundPresentation
    if (pending?.request === this.activationRequest) {
      this.pendingBackgroundPresentation = {
        request: pending.request,
        presentation: next,
        hasUpdate: true,
      }
      return
    }
    const current = this.active
    if (!current || !this.isCurrent(current)) return
    current.presentation = next
    this.options.map.updateBackgroundPresentation(next)
  }

  private pendingPresentationFor(
    request: number,
    map: WorkspaceMapSnapshot,
  ): MapBackgroundPresentation {
    const pending = this.pendingBackgroundPresentation
    return pending?.request === request
      ? pending.presentation
      : map.background
  }

  private flushPendingPresentation(current: ActivationGeneration, request: number): void {
    const pending = this.pendingBackgroundPresentation
    if (!this.isCurrent(current) || pending?.request !== request) return
    this.pendingBackgroundPresentation = null
    current.presentation = pending.presentation
    if (pending.hasUpdate) {
      this.options.map.updateBackgroundPresentation(pending.presentation)
    }
  }

  /**
   * Synchronously fences one Design/map generation before Scene replacement.
   * Its returned settlement owns the asynchronous layer disposal and map
   * release; callers must not await it to establish the replacement fence.
   */
  requestGenerationDisconnect(): Promise<void> {
    if (this.disposed) {
      this.pendingBackgroundPresentation = null
      const cleanup = this.retainedCleanup ?? Promise.resolve()
      this.recordOwnedReentry(cleanup)
      return cleanup
    }
    this.pendingBackgroundPresentation = null
    ++this.activationRequest
    const cleanup = this.cleanupActiveGeneration()
    this.recordOwnedReentry(cleanup)
    // Design replacement is synchronous. Keep a terminal observation here so
    // an intentionally unjoined cleanup cannot become an unhandled rejection.
    void cleanup.catch((error) => {
      console.error('Shared workspace Design-replacement cleanup failed:', error)
    })
    return cleanup
  }

  teardown(): Promise<void> {
    if (this.terminalTeardownResult) {
      this.recordOwnedReentry(this.terminalTeardownResult)
      return this.terminalTeardownResult
    }
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const teardown = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    this.pendingBackgroundPresentation = null
    this.terminalTeardownResult = teardown
    this.recordOwnedReentry(teardown)
    const start = () => {
      if (this.terminalTeardownStarted) return
      this.terminalTeardownStarted = true
      void this.performTeardown().then(resolve, reject)
    }
    if (this.ownedCallbackDepth > 0) queueMicrotask(start)
    else start()
    return teardown
  }

  /** Reports observation ownership without exposing the coordinator's callback state. */
  ownsLifecycleFailureObservation(result: Promise<unknown>): boolean {
    return this.observedOwnedReentryResults.has(result)
  }

  private async performTeardown(): Promise<void> {
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
    const current = this.active
    if (!current) return this.retainedCleanup ?? Promise.resolve()
    this.active = null
    current.cancelled = true
    ++this.generation
    const resourceCleanup = this.prepareCleanup(current)
    const cleanup = this.prepareGenerationCleanup(current, resourceCleanup)
    this.retainedCleanup = cleanup
    // Publish the shared cleanup transaction before aborting acquisition or
    // invoking disposers. Either boundary may synchronously reenter us.
    this.runOwnedCallback('map acquisition abort', () => current.abortController.abort())
    this.startCleanup(current)
    return cleanup
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
      current.terminalMapFailure = error
      this.mapUnavailable = true
      return this.runtimeInitialized
        ? this.failActiveRenderer(current)
        : this.runtimeInit
          ? this.failWhileRuntimeInitializes(current)
          : this.failAdmission(current)
    })
    return current.failure
  }

  private async failAdmission(current: ActivationGeneration): Promise<WorkspaceActivationOutcome> {
    // Nothing was mounted: the runtime keeps its Scene without a renderer.
    const errors: unknown[] = []
    try {
      await this.cleanup(current)
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    if (!this.isCurrent(current)) return 'cancelled'
    throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace admission cleanup failed')
    return 'map-unavailable'
  }

  private async failActiveRenderer(current: ActivationGeneration): Promise<WorkspaceActivationOutcome> {
    const errors: unknown[] = []
    await this.unmountRuntimeRenderer(current, errors)
    try {
      await this.cleanup(current)
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    if (!this.isCurrent(current)) return 'cancelled'
    throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace map failure handling failed')
    return 'map-unavailable'
  }

  private async failWhileRuntimeInitializes(current: ActivationGeneration): Promise<WorkspaceActivationOutcome> {
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
    await this.unmountRuntimeRenderer(current, errors)
    if (!this.isCurrent(current)) return 'cancelled'
    throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace map failure handling failed')
    return 'map-unavailable'
  }

  private async unmountRuntimeRenderer(current: ActivationGeneration, errors: unknown[]): Promise<void> {
    try {
      await this.runOwnedCallback('renderer unmount', () => this.options.runtime.unmountRenderer())
    } catch (unmountError) {
      if (unmountError instanceof WorkspaceActivationOwnershipError) throw unmountError
      if (this.isCurrent(current)) errors.push(unmountError)
    }
  }

  private cleanup(current: ActivationGeneration): Promise<void> {
    const cleanup = this.prepareCleanup(current)
    this.startCleanup(current)
    return cleanup
  }

  private prepareGenerationCleanup(
    current: ActivationGeneration,
    resourceCleanup: Promise<void>,
  ): Promise<void> {
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const cleanup = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    // Capture the already-admitted failure transaction. It can itself await
    // resourceCleanup, so the generation transaction observes both without
    // feeding either result back into the resource cleanup path.
    const failure = current.failure
    void Promise.allSettled<unknown>([
      resourceCleanup,
      failure ?? Promise.resolve(),
    ]).then((settlements) => {
      const errors = settlements.flatMap((settlement) =>
        settlement.status === 'rejected' ? [settlement.reason] : [],
      )
      try {
        throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace teardown failed')
        resolve()
      } catch (error) {
        reject(error)
      }
    })
    return cleanup
  }

  private prepareCleanup(current: ActivationGeneration): Promise<void> {
    if (current.cleanupResult) return current.cleanupResult
    let resolve!: () => void
    let reject!: (error: unknown) => void
    current.cleanupResult = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    current.finishCleanup = (errors) => {
      try {
        throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace resource cleanup failed')
        resolve()
      } catch (error) {
        reject(error)
      }
    }
    return current.cleanupResult
  }

  private beginSetup(current: ActivationGeneration): () => void {
    if (current.setupResult) {
      throw new Error('Shared workspace attempted concurrent generation setup.')
    }
    let resolve!: () => void
    const setup = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise
    })
    current.setupResult = setup
    return () => {
      if (current.setupResult === setup) current.setupResult = null
      resolve()
    }
  }

  private startCleanup(current: ActivationGeneration): void {
    if (current.cleanupStarted) return
    current.cleanupStarted = true
    const errors: unknown[] = []
    this.cleanupGenerationCallbacks(current, errors)
    const setup = current.setupResult
    if (setup) {
      void setup.then(
        () => {
          this.cleanupGenerationCallbacks(current, errors)
          this.cleanupLayerAndMap(current, errors)
        },
        (error) => current.finishCleanup?.([...errors, error]),
      )
      return
    }
    this.cleanupLayerAndMap(current, errors)
  }

  private cleanupGenerationCallbacks(current: ActivationGeneration, errors: unknown[]): void {
    try {
      this.runOwnedCallback('map contributions disconnect', () => this.options.map.updateMapContributions(null))
    } catch (error) {
      errors.push(error)
    }
    const unwatchFailure = current.unwatchFailure
    current.unwatchFailure = null
    const unsubscribeCameraFailure = current.unsubscribeCameraFailure
    current.unsubscribeCameraFailure = null
    const disposeStyleRestorer = current.disposeStyleRestorer
    current.disposeStyleRestorer = null
    try {
      this.runOwnedCallback('style restorer disposal', () => disposeStyleRestorer?.())
    } catch (error) {
      errors.push(error)
    }
    try {
      this.runOwnedCallback('map failure watcher disposal', () => unwatchFailure?.())
    } catch (error) {
      errors.push(error)
    }
    try {
      this.runOwnedCallback('camera failure subscription disposal', () => unsubscribeCameraFailure?.())
    } catch (error) {
      errors.push(error)
    }
    if (current.cameraAttached) {
      current.cameraAttached = false
      try {
        this.runOwnedCallback('camera detachment', () => this.options.camera.attachment.detach())
      } catch (error) {
        errors.push(error)
      }
    }
  }

  private cleanupLayerAndMap(current: ActivationGeneration, errors: unknown[]): void {
    const layer = current.layer
    current.layer = null
    let layerDisposal: Promise<void>
    try {
      // Calling dispose is intentionally synchronous: Design replacement must
      // fence the layer before Scene authority changes, even though graphics
      // cleanup and map release settle later.
      layerDisposal = Promise.resolve(this.runOwnedCallback(
        'shared scene layer disposal',
        () => layer?.dispose({ mapWillBeRemoved: true }),
      ))
    } catch (error) {
      errors.push(error)
      layerDisposal = Promise.resolve()
    }
    const map = current.map
    current.map = null
    void layerDisposal.then(
      () => this.releaseCleanupMap(map, errors, current.terminalMapFailure),
      (error) => {
        errors.push(error)
        this.releaseCleanupMap(map, errors, current.terminalMapFailure)
      },
    ).then(
      () => current.finishCleanup?.(errors),
      (error) => current.finishCleanup?.([...errors, error]),
    )
  }

  private releaseCleanupMap(
    map: WorkspaceActivationMap | null,
    errors: unknown[],
    failure?: unknown,
  ): void {
    try {
      if (map) this.runOwnedCallback('map release', () => failure === undefined
        ? this.options.map.releaseMap(map)
        : this.options.map.releaseMap(map, failure))
    } catch (error) {
      errors.push(error)
    }
  }

  private runOwnedCallback<T>(boundary: string, callback: () => T): T {
    this.ownedCallbackDepth += 1
    try {
      const result = callback()
      if (
        typeof result === 'object'
        && result !== null
        && this.ownedReentryResults.has(result as unknown as Promise<unknown>)
      ) {
        throw new WorkspaceActivationOwnershipError(
          `Shared workspace ${boundary} must not return a coordinator lifecycle operation.`,
        )
      }
      return result
    } finally {
      this.ownedCallbackDepth -= 1
    }
  }

  private recordOwnedReentry(result: Promise<unknown>): void {
    if (this.ownedCallbackDepth <= 0) return
    this.ownedReentryResults.add(result)
    if (this.observedOwnedReentryResults.has(result)) return
    this.observedOwnedReentryResults.add(result)
    void result.catch((error) => {
      console.error('Reentrant shared workspace lifecycle operation failed:', error)
    })
  }

  private observeFailure(current: ActivationGeneration, error: unknown): void {
    void this.reportFailureFor(current, error).catch((failure) => {
      if (this.isCurrent(current)) {
        console.error('Shared workspace map failure handling failed:', failure)
      }
    })
  }

  private restoreSharedSceneLayer(
    current: ActivationGeneration,
    map: WorkspaceActivationMap,
    layer: SharedMapSceneLayer,
  ): void {
    if (!this.isCurrent(current) || current.layer !== layer || current.map !== map) return
    const existingLayer = this.runOwnedCallback(
      'shared scene layer lookup',
      () => map.getLayer(MAPLIBRE_SHARED_SCENE_LAYER_ID),
    )
    if (!this.isCurrent(current)) return
    if (existingLayer == null) {
      this.runOwnedCallback(
        'shared scene layer attachment',
        () => map.addLayer(layer.layer as unknown as Record<string, unknown>),
      )
    }
    if (!this.isCurrent(current)) return
    const phase = this.runOwnedCallback(
      'shared scene layer diagnostics',
      () => layer.diagnostics.phase,
    )
    if (!this.isCurrent(current)) return
    if (phase !== 'attached') {
      throw new Error('MapLibre did not attach the initialized shared scene layer.')
    }
  }

  private initializeRuntime(): Promise<void> {
    // Record the pending transaction before runtime code runs so a synchronous
    // throw cannot be mistaken for a pre-admission map failure and retried.
    if (!this.runtimeInit) {
      this.runtimeInit = Promise.resolve().then(() => this.runOwnedCallback(
        'runtime initialization',
        () => this.options.runtime.init(this.options.container),
      ))
    }
    return this.runtimeInit
  }

  private destroyRuntime(errors: unknown[]): void {
    if (this.runtimeDestroyed) return
    this.runtimeDestroyed = true
    try {
      this.runOwnedCallback('runtime destruction', () => this.options.runtime.destroy())
    } catch (error) {
      errors.push(error)
    }
  }

  private releaseStaleMap(map: WorkspaceActivationMap): void {
    try {
      this.runOwnedCallback('stale map release', () => this.options.map.releaseMap(map))
    } catch (error) {
      console.error('Failed to release stale MapLibre workspace map:', error)
    }
  }

  private isCurrent(current: ActivationGeneration): boolean {
    return !current.cancelled && this.active === current && this.generation === current.id
  }
}

class WorkspaceActivationOwnershipError extends Error {
  override readonly name = 'WorkspaceActivationOwnershipError'
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
    initialCenter: Object.freeze({
      lat: snapshot.initialCenter.lat,
      lon: snapshot.initialCenter.lon,
    }),
    background: captureMapBackgroundPresentation(snapshot.background),
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
