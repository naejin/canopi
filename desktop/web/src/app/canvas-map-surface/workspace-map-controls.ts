import { WorkspaceMapContributions, type WorkspaceMapContributionsOptions } from './workspace-map-contributions'
import { captureWorkspaceMapContributions, type WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'
import type { MapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import { createMapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import {
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_SATELLITE_LAYER_ID,
  MAPLIBRE_SATELLITE_SOURCE_ID,
} from '../../maplibre/config'
import { BasemapTileAuth } from '../../maplibre/basemap-tile-auth'
import {
  captureMapBackgroundPresentation,
  mountMapBackground,
  type MapBackgroundHandle,
  type MapBackgroundMap,
  type MapBackgroundPresentation,
} from '../../maplibre/map-background'
import { OPENFREEMAP_LAYER_PREFIX, OPENFREEMAP_SOURCE_PREFIX } from '../../maplibre/openfreemap-basemap'
import { mapErrorResourceId } from '../../maplibre/map-error-owner'
import { describeMapErrorEvent, logMapError, redactCredentials, redactError } from '../../maplibre/redact-credentials'
import type { MapLibreSurfaceLifetime } from '../../maplibre/surface-adapter'
import { IDLE_MAPLIBRE_CANVAS_SURFACE_STATE } from '../../maplibre/canvas-surface-state'
import {
  createWorkspaceMapLibreMap,
  type WorkspaceMapSnapshot,
} from '../../maplibre/workspace-map'
import type { MapLibreMapInstance } from '../../maplibre/loader'
import type { ViewScreen } from '../../canvas/runtime/view/types'
import {
  createMapLayerStackDescriptors,
  reconcileMapLayerStack,
} from '../map-layers/bands'
import {
  WorkspaceWebGL2UnavailableError,
  type WorkspaceActivationMap,
  type WorkspaceActivationMapControls,
} from './workspace-activation'

interface WorkspaceMapAttempt {
  readonly sessionIdentity: object
  readonly contributions: WorkspaceMapContributions
  contributionSnapshot: WorkspaceMapContributionSnapshot | null
  readonly signal: AbortSignal
  readonly snapshot: WorkspaceMapSnapshot
  presentation: MapBackgroundPresentation
  /** The map's own credential owner, created before the map for its transform. */
  readonly tileAuth: BasemapTileAuth
  /** The map's background band owner, mounted once per map lifetime. */
  background: MapBackgroundHandle | null
  lifetime: MapLibreSurfaceLifetime | null
  map: WorkspaceActivationMap | null
  maplibre: unknown
  settled: boolean
  released: boolean
  admitted: boolean
  styleRestorer: (() => void) | null
  pendingStyleRestore: boolean
  pendingPresentationSync: boolean
  reconciling: boolean
  pendingFailure: Error | null
  failureReported: boolean
  failureReporter: ((error: Error) => void) | null
  abort: () => void
  resolve: (map: WorkspaceActivationMap) => void
  reject: (error: unknown) => void
}

export interface WorkspaceActivationMapControlsOptions {
  readonly contributions?: Omit<WorkspaceMapContributionsOptions, 'sessionIdentity' | 'onFailure'>
  readonly container: HTMLElement
  readonly surface?: MapLibreSurfaceAdapter<MapLibreMapInstance>
  readonly logError?: (message?: unknown, ...optionalParams: unknown[]) => void
  readonly canCreateWebGL2Context?: () => boolean
  /**
   * The workspace request's resize owner (spec §1.1 "Resize"): the map container's new size goes to the camera, whose driver
   * resizes the map (CameraDriver.setScreen). The MapLibre host never resizes the map itself.
   */
  readonly setScreen?: (screen: ViewScreen) => void
}

/**
 * Bridges the coordinator's awaited map admission to the Surface Adapter.
 * The adapter remains the only owner allowed to remove the MapLibre map.
 */
export class WorkspaceMapControls implements WorkspaceActivationMapControls {
  private readonly surface: MapLibreSurfaceAdapter<MapLibreMapInstance>
  private readonly logError: (message?: unknown, ...optionalParams: unknown[]) => void
  private attempt: WorkspaceMapAttempt | null = null
  private attributionCompact: boolean | null = null

  constructor(private readonly options: WorkspaceActivationMapControlsOptions) {
    this.surface = options.surface ?? createMapLibreSurfaceAdapter()
    this.logError = options.logError ?? logMapError
  }

  createMap(
    signal: AbortSignal,
    snapshot: WorkspaceMapSnapshot,
    sessionIdentity: object,
  ): Promise<WorkspaceActivationMap> {
    const ownedSnapshot = captureMapSnapshot(snapshot)
    const previous = this.attempt
    if (previous && !previous.settled) {
      this.rejectAttempt(previous, abortError())
    } else {
      this.releaseAttempt(previous)
    }
    if (!(this.options.canCreateWebGL2Context ?? canCreateWebGL2Context)()) {
      // No map attempt exists to publish its failure, so publish it here.
      this.publishUnavailable()
      return Promise.reject(new WorkspaceWebGL2UnavailableError())
    }
    this.surface.attach(this.options.container)

    return new Promise<WorkspaceActivationMap>((resolve, reject) => {
      const attempt: WorkspaceMapAttempt = {
        sessionIdentity,
        contributions: new WorkspaceMapContributions({
          ...this.options.contributions,
          sessionIdentity,
          logError: this.logError,
          onFailure: (error) => this.reportRestorationFailure(attempt, error),
        }),
        contributionSnapshot: null,
        signal,
        snapshot: ownedSnapshot,
        presentation: ownedSnapshot.background,
        tileAuth: new BasemapTileAuth(),
        background: null,
        lifetime: null,
        map: null,
        maplibre: null,
        settled: false,
        released: false,
        admitted: false,
        styleRestorer: null,
        pendingStyleRestore: false,
        pendingPresentationSync: false,
        reconciling: false,
        pendingFailure: null,
        failureReported: false,
        failureReporter: null,
        abort: () => {},
        resolve,
        reject,
      }
      this.attempt = attempt
      const abort = () => this.rejectAttempt(attempt, abortError())
      attempt.abort = abort
      signal.addEventListener('abort', abort, { once: true })

      if (signal.aborted) {
        abort()
        return
      }

      this.surface.requestMap({
        key: 'shared-workspace',
        createMap: (maplibre, container) => createWorkspaceMapLibreMap(
          maplibre,
          container,
          attempt.snapshot,
          attempt.tileAuth.transformRequest,
        ),
        onCreate: (context) => {
          const map = context.map as WorkspaceActivationMap
          attempt.map = map
          attempt.lifetime = context.lifetime
          attempt.contributions.attach(context)
          const isLive = () => !attempt.released && !attempt.signal.aborted && context.isCurrent()
          if (!isLive()) return
          // Errors are classified by owner. After admission, an error naming an
          // optional contribution or the background band, or a request for the
          // Basemap's own sprite, glyphs or TileJSON, only skips that
          // contribution; context loss, pre-admission engine failure and any
          // other unattributed error or one naming the shared scene layer are core.
          const reportMapError = (event: unknown) => {
            if (!isLive()) return
            if (attempt.admitted && attempt.contributions.handleMapError(event)) return
            // The Basemap's sprite, glyphs or TileJSON failed (offline): its notice shows, the map keeps drawing.
            if (attempt.admitted && attempt.background?.claimMapError(event)) {
              this.logError('MapLibre workspace basemap resource failed to load:', describeMapErrorEvent(event))
              return
            }
            if (attempt.admitted && isPassiveBasemapError(event)) {
              this.logError('Passive MapLibre workspace basemap error:', describeMapErrorEvent(event))
              return
            }
            const error = mapError(event)
            if (!attempt.admitted) {
              this.rejectAttempt(attempt, error)
              return
            }
            this.reportRestorationFailure(attempt, error)
          }
          const handleContextLoss = (event?: unknown) => {
            const error = contextLossError(event)
            if (!isLive()) return
            if (!attempt.admitted) {
              this.rejectAttempt(attempt, error)
              return
            }
            this.reportRestorationFailure(attempt, error)
          }
          const handleStyleLoad = () => {
            if (!isLive()) return
            if (attempt.admitted) {
              if (attempt.failureReported) return
              attempt.pendingStyleRestore = true
              this.drainReconciliation(attempt)
              return
            }
            if (attempt.settled) return
            // The local style is admitted before a remote source is attached.
            // MapLibre may synchronously publish a passive source error while
            // addSource runs; only a thrown configuration error rejects this map.
            attempt.admitted = true
            try {
              this.applyBackground(attempt)
              if (attempt.failureReported || attempt.released) return
              attempt.contributions.restoreStyle()
              if (attempt.failureReported || attempt.released) return
              attempt.settled = true
              signal.removeEventListener('abort', abort)
              resolve(map)
            } catch (error) {
              attempt.admitted = false
              this.rejectAttempt(attempt, error)
            }
          }

          if (!this.getWebGL2Context(map)) {
            this.rejectAttempt(
              attempt,
              new Error('MapLibre did not expose a WebGL2 context for shared rendering.'),
            )
            return
          }
          context.lifetime.on('style.load', handleStyleLoad)
          context.lifetime.on('error', reportMapError)
          context.lifetime.on('webglcontextlost', handleContextLoss)
          if (signal.aborted) abort()
        },
        onResize: (_context, size) => {
          if (attempt.released) return
          this.options.setScreen?.({ width: size.width, height: size.height, devicePixelRatio: window.devicePixelRatio })
        },
        onCreateError: (error) => this.rejectAttempt(attempt, error),
      })
    })
  }

  releaseMap(map: WorkspaceActivationMap, failure?: unknown): void {
    const attempt = this.attempt
    if (!attempt || attempt.map !== map) return
    if (failure !== undefined) attempt.pendingFailure ??= mapError(failure)
    this.releaseAttempt(attempt)
  }

  getWebGL2Context(map: WorkspaceActivationMap): WebGL2RenderingContext | null {
    return map.getCanvas().getContext('webgl2')
  }

  updateBackgroundPresentation(presentation: MapBackgroundPresentation): void {
    const attempt = this.attempt
    if (!attempt || attempt.released || attempt.failureReported) return
    attempt.presentation = captureMapBackgroundPresentation(presentation)
    if (!attempt.map || !attempt.admitted) return
    attempt.pendingPresentationSync = true
    this.drainReconciliation(attempt)
  }

  retryBasemap(): void {
    const attempt = this.attempt
    if (!attempt || attempt.released || attempt.failureReported || !attempt.admitted) return
    // The latest presentation again: a Basemap that is not installed, or whose resources failed, is downloaded again.
    attempt.background?.retry(attempt.presentation)
  }

  setAttributionCompact(compact: boolean): void {
    this.attributionCompact = compact
    const attempt = this.attempt
    if (!attempt || attempt.released || attempt.failureReported) return
    attempt.background?.setAttributionCompact(compact)
  }

  updateMapContributions(snapshot: WorkspaceMapContributionSnapshot | null): void {
    const attempt = this.attempt
    if (!attempt || attempt.released || attempt.failureReported) return
    if (snapshot && snapshot.sessionIdentity !== attempt.sessionIdentity) return
    attempt.contributionSnapshot = snapshot && captureWorkspaceMapContributions(snapshot)
    attempt.contributions.update(attempt.contributionSnapshot)
  }

  watchFailure(
    map: WorkspaceActivationMap,
    reportFailure: (error: unknown) => void,
  ): () => void {
    const attempt = this.attempt
    if (!attempt || attempt.map !== map || attempt.released) return () => {}
    let active = true
    const report = (error: Error) => {
      if (active && !attempt.released) reportFailure(error)
    }
    attempt.failureReporter = report
    if (attempt.pendingFailure) report(attempt.pendingFailure)
    return () => {
      active = false
      if (attempt.failureReporter === report) attempt.failureReporter = null
    }
  }

  installStyleRestorer(
    map: WorkspaceActivationMap,
    restore: () => void,
  ): () => void {
    const attempt = this.attempt
    if (
      !attempt
      || attempt.map !== map
      || attempt.released
      || attempt.failureReported
      || !attempt.admitted
    ) return () => {}
    let active = true
    const restoreCurrentStyle = () => {
      if (!active) return
      try {
        restore()
      } catch (error) {
        this.reportRestorationFailure(attempt, error)
      }
    }
    attempt.styleRestorer = restoreCurrentStyle
    const hadPendingStyleRestore = attempt.pendingStyleRestore
    this.drainReconciliation(attempt)
    if (!hadPendingStyleRestore) {
      try {
        this.reconcileLayerStack(attempt)
      } catch (error) {
        this.reportRestorationFailure(attempt, error)
      }
    }
    return () => {
      active = false
      if (attempt.styleRestorer === restoreCurrentStyle) {
        attempt.styleRestorer = null
      }
    }
  }

  private publishUnavailable(): void {
    try {
      this.options.contributions?.onStateChange?.({
        ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
        status: 'error',
      })
    } catch (observerError) {
      this.logError('Map state observer failed:', observerError)
    }
  }

  /** Mounts the background band once per map lifetime and applies the latest presentation. */
  private applyBackground(attempt: WorkspaceMapAttempt): void {
    const { map, lifetime } = attempt
    if (!map || !lifetime) return
    attempt.background ??= mountMapBackground({
      map: map as unknown as MapBackgroundMap,
      maplibre: (this.surface as { maplibre?: unknown }).maplibre,
      tileAuth: attempt.tileAuth,
      lifetime,
      onError: (error) => this.logError('Map basemap style failed to load:', error),
      onBasemapStatus: (status) => attempt.contributions.setBasemapStatus(status),
    })
    if (this.attributionCompact !== null) attempt.background.setAttributionCompact(this.attributionCompact)
    attempt.background.update(attempt.presentation)
  }

  private drainReconciliation(attempt: WorkspaceMapAttempt): void {
    if (
      (!attempt.pendingStyleRestore && !attempt.pendingPresentationSync)
      || attempt.reconciling
      || attempt.released
      || attempt.failureReported
    ) return
    attempt.reconciling = true
    try {
      while (
        (attempt.pendingStyleRestore || attempt.pendingPresentationSync)
        && !attempt.released
        && !attempt.failureReported
      ) {
        const restoreScene = attempt.pendingStyleRestore && attempt.styleRestorer != null
        const syncPresentation = attempt.pendingPresentationSync
        if (!restoreScene && !syncPresentation) break
        if (restoreScene) attempt.pendingStyleRestore = false
        if (syncPresentation) attempt.pendingPresentationSync = false
        // A reloaded style is an empty stack again, so the background band is
        // re-installed; an unexpired imagery session is reused.
        if (restoreScene) attempt.background?.restore()
        if (attempt.failureReported) break
        this.applyBackground(attempt)
        if (attempt.failureReported) break
        if (restoreScene) {
          attempt.contributions.restoreStyle()
          if (attempt.released || attempt.failureReported) break
          attempt.styleRestorer?.()
        }
        if (attempt.failureReported) break
        this.reconcileLayerStack(attempt)
      }
    } catch (error) {
      this.reportRestorationFailure(attempt, error)
    } finally {
      attempt.reconciling = false
      if (
        (attempt.pendingPresentationSync
          || (attempt.pendingStyleRestore && attempt.styleRestorer != null))
        && !attempt.released
        && !attempt.failureReported
      ) {
        queueMicrotask(() => this.drainReconciliation(attempt))
      }
    }
  }

  private reconcileLayerStack(attempt: WorkspaceMapAttempt): void {
    if (!attempt.map || attempt.released) return
    reconcileMapLayerStack(
      attempt.map,
      createMapLayerStackDescriptors(attempt.contributionSnapshot?.lidar.map((layer) => layer.id) ?? []),
    )
  }

  private reportRestorationFailure(attempt: WorkspaceMapAttempt, error: unknown): void {
    if (attempt.released || attempt.failureReported) return
    attempt.failureReported = true
    attempt.pendingStyleRestore = false
    attempt.pendingPresentationSync = false
    const failure = mapError(error)
    attempt.pendingFailure = failure
    attempt.contributions.dispose(failure)
    if (!attempt.settled) {
      this.rejectAttempt(attempt, failure)
      return
    }
    attempt.failureReporter?.(failure)
  }

  private rejectAttempt(attempt: WorkspaceMapAttempt, error: unknown): void {
    if (attempt.settled) return
    attempt.settled = true
    if (!(error instanceof WorkspaceAcquisitionCancelled)) attempt.pendingFailure ??= mapError(error)
    attempt.signal.removeEventListener('abort', attempt.abort)
    attempt.reject(error)
    this.releaseAttempt(attempt)
  }

  private releaseAttempt(attempt: WorkspaceMapAttempt | null): void {
    if (!attempt || attempt.released) return
    attempt.released = true
    attempt.background?.dispose()
    attempt.background = null
    attempt.lifetime = null
    attempt.signal.removeEventListener('abort', attempt.abort)
    if (this.attempt === attempt) this.attempt = null
    // Host/Surface Adapter performs listener cleanup, observer disconnect, and
    // final map removal. No app-layer code calls map.remove().
    try {
      attempt.contributions.dispose(attempt.pendingFailure ?? undefined)
    } finally {
      this.surface.destroy()
    }
  }
}

function canCreateWebGL2Context(): boolean {
  if (typeof WebGL2RenderingContext === 'undefined') return false
  try {
    const context = document.createElement('canvas').getContext('webgl2')
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    return context != null
  } catch {
    return false
  }
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

function abortError(): Error {
  return new WorkspaceAcquisitionCancelled('Shared workspace map acquisition was cancelled.')
}

class WorkspaceAcquisitionCancelled extends Error {
  override readonly name = 'AbortError'
}

function contextLossError(event: unknown): Error {
  return new Error(
    event instanceof Error
      ? event.message
      : 'MapLibre WebGL context was lost while preparing the shared workspace.',
  )
}

function isPassiveBasemapError(event: unknown): boolean {
  const id = mapErrorResourceId(event)
  return id !== null && (
    id === MAPLIBRE_SATELLITE_SOURCE_ID
    || id === MAPLIBRE_SATELLITE_LAYER_ID
    || id === MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID
    || id.startsWith(OPENFREEMAP_SOURCE_PREFIX)
    || id.startsWith(OPENFREEMAP_LAYER_PREFIX)
  )
}

function mapError(event: unknown): Error {
  if (event instanceof Error) return redactError(event)
  if (typeof event === 'string' && event.length > 0) return new Error(redactCredentials(event))
  if (typeof event === 'object' && event !== null && 'message' in event
    && typeof event.message === 'string' && event.message.length > 0) {
    return new Error(redactCredentials(event.message))
  }
  if (
    typeof event === 'object'
    && event !== null
    && 'error' in event
    && event.error !== event
  ) {
    return mapError(event.error)
  }
  return new Error('MapLibre failed while preparing the shared workspace.')
}
