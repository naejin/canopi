import { WorkspaceMapContributions, type WorkspaceMapContributionsOptions } from './workspace-map-contributions'
import { captureWorkspaceMapContributions, type WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'
import type { MapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import { createMapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import {
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
} from '../../maplibre/config'
import type { BasemapStyle } from '../../generated/contracts'
import { bindBasemapProvider, createAttributionControls, createBasemapProvider, installBasemapConfigObserver, mapStyleReadiness } from '../../maplibre/basemap-bind'
import type { BasemapProvider, BasemapViewport } from '../../maplibre/basemap-provider-session'
import { BasemapTileAuth } from '../../maplibre/basemap-tile-auth'
import type { MapLibreSurfaceLifetime } from '../../maplibre/surface-adapter'
import {
  createWorkspaceMapLibreMap,
  captureWorkspaceBasemapPresentation,
  type WorkspaceMapSnapshot,
  type WorkspaceBasemapPresentation,
  workspaceBasemapPresentationFromSnapshot,
} from '../../maplibre/workspace-map'
import type { MapLibreMapInstance } from '../../maplibre/loader'
import {
  createMapLayerStackDescriptors,
  reconcileMapLayerStack,
} from './layer-stack'
import type {
  WorkspaceActivationMap,
  WorkspaceActivationMapControls,
} from './workspace-activation'

interface WorkspaceMapAttempt {
  readonly sessionIdentity: object
  readonly contributions: WorkspaceMapContributions
  contributionSnapshot: WorkspaceMapContributionSnapshot | null
  readonly signal: AbortSignal
  readonly snapshot: WorkspaceMapSnapshot
  presentation: WorkspaceBasemapPresentation
  /** The map's own credential owner, created before the map for its transform. */
  readonly tileAuth: BasemapTileAuth
  /** The one shared provider for this map lifetime, created with the map. */
  provider: BasemapProvider | null
  /** The binding's disposer plus the opacity subscription. */
  basemapTeardown: (() => void) | null
  /** The style the live provider is already serving, if any. */
  basemapProviderStyle: BasemapStyle | null
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
}

/**
 * Bridges the coordinator's awaited map admission to the Surface Adapter.
 * The adapter remains the only owner allowed to remove the MapLibre map.
 */
export class WorkspaceMapControls implements WorkspaceActivationMapControls {
  private readonly surface: MapLibreSurfaceAdapter<MapLibreMapInstance>
  private readonly logError: (message?: unknown, ...optionalParams: unknown[]) => void
  private attempt: WorkspaceMapAttempt | null = null

  constructor(private readonly options: WorkspaceActivationMapControlsOptions) {
    this.surface = options.surface ?? createMapLibreSurfaceAdapter()
    this.logError = options.logError ?? console.error
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
      return Promise.reject(new Error('WebGL2 is unavailable for the shared workspace map.'))
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
        presentation: workspaceBasemapPresentationFromSnapshot(ownedSnapshot),
        tileAuth: new BasemapTileAuth(),
        provider: null,
        basemapTeardown: null,
        basemapProviderStyle: null,
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
          const reportMapError = (event: unknown) => {
            if (!isLive()) return
            if (attempt.admitted && attempt.contributions.handleSourceError(event)) return
            if (attempt.admitted && isPassiveBasemapError(event)) {
              this.logError('Passive MapLibre workspace basemap error:', event)
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
              // A reloaded style is an empty stack again, so the basemap
              // contribution has to be re-applied even though the provider
              // itself has not changed. An unexpired session is reused, so this
              // costs no extra provider request.
              attempt.basemapProviderStyle = null
              this.drainReconciliation(attempt)
              return
            }
            if (attempt.settled) return
            // The local style is admitted before a remote source is attached.
            // MapLibre may synchronously publish a passive source error while
            // addSource runs; only a thrown configuration error rejects this map.
            attempt.admitted = true
            try {
              this.applyBasemapPresentation(attempt)
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

  updateBasemapPresentation(presentation: WorkspaceBasemapPresentation): void {
    const attempt = this.attempt
    if (!attempt || attempt.released || attempt.failureReported) return
    attempt.presentation = captureWorkspaceBasemapPresentation(presentation)
    if (!attempt.map || !attempt.admitted) return
    attempt.pendingPresentationSync = true
    this.drainReconciliation(attempt)
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

  /**
   * Drive the canvas basemap through the same provider the other surfaces use.
   *
   * The canvas previously built a static contribution from a descriptor, which
   * cannot follow the official Google path at all: that path needs a session
   * acquired per generation and an authenticated tile request, and it is only
   * reachable through the shared provider and the map's request transform.
   */
  private applyBasemapPresentation(attempt: WorkspaceMapAttempt): void {
    const { map, snapshot, presentation } = attempt
    if (!map) return
    if (snapshot.placementStatus !== 'confirmed' || !presentation.basemapVisible) {
      this.releaseBasemapProvider(attempt)
      this.removeBasemapContribution(map)
      return
    }
    const provider = this.ensureBasemapProvider(attempt)
    if (!provider) return
    // An opacity-only update must not re-issue a session or rebuild the
    // contribution; only a provider change does that.
    if (attempt.basemapProviderStyle !== presentation.basemapStyle) {
      attempt.basemapProviderStyle = presentation.basemapStyle
      provider.update(
        { style: presentation.basemapStyle },
        readWorkspaceMapViewport(map),
      )
    } else {
      // Opacity alone changes no provider input, so the contribution is left
      // exactly as it is and only the paint property is written.
      this.applyBasemapOpacity(attempt)
    }
  }

  private applyBasemapOpacity(attempt: WorkspaceMapAttempt): void {
    const map = attempt.map
    // No contribution means no layer to paint; writing a property for a layer
    // that does not exist is not an opacity update.
    if (!map?.getLayer?.(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)) return
    map.setPaintProperty?.(
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      'raster-opacity',
      attempt.presentation.basemapOpacity,
    )
  }

  /**
   * Create this map lifetime's provider and bind it to the map once.
   *
   * The binding owns contribution reconciliation, so this surface never adds or
   * removes the basemap source itself while a provider is live.
   */
  private ensureBasemapProvider(attempt: WorkspaceMapAttempt): BasemapProvider | null {
    const map = attempt.map
    const lifetime = attempt.lifetime
    if (!map || !lifetime) return null
    if (attempt.provider) return attempt.provider
    const provider = createBasemapProvider(attempt.tileAuth)
    attempt.provider = provider
    const unbind = bindBasemapProvider({
      provider,
      map: map as unknown as Parameters<typeof bindBasemapProvider>[0]['map'],
      attributionControls: createAttributionControls(
        (this.surface as { maplibre?: unknown }).maplibre,
        map as unknown as Parameters<typeof createAttributionControls>[1],
      ),
      tileAuth: attempt.tileAuth,
      styleReady: mapStyleReadiness(
        map as unknown as { isStyleLoaded?(): boolean; loaded?(): boolean },
        lifetime,
      ),
      // Opacity is a property of the layer the binding reconciles, so it is
      // re-applied exactly when the contribution is.
      afterApply: () => this.applyBasemapOpacity(attempt),
      // The canvas keeps a local background beneath the basemap.
      beforeLayerId: () => {
        const order = map.getLayersOrder()
        const background = order.indexOf(MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID)
        return background >= 0 ? order[background + 1] ?? null : order[0] ?? null
      },
    })
    // A settled camera move refreshes the provider's viewport metadata in
    // place; the session is not per-viewport.
    lifetime.on('moveend', () =>
      provider.updateViewport(readWorkspaceMapViewport(map)),
    )
    // Style, key and locale are reactive inputs of this map lifetime: an
    // already mounted provider is updated when any of them change.
    lifetime.addCleanup(
      installBasemapConfigObserver(
        provider,
        () => ({ style: attempt.presentation.basemapStyle }),
        () => readWorkspaceMapViewport(map),
      ),
    )
    attempt.basemapTeardown = () => {
      unbind()
      provider.dispose()
    }
    return provider
  }

  /** Stop the canvas provider and release its session and timers. */
  private releaseBasemapProvider(attempt: WorkspaceMapAttempt): void {
    attempt.basemapTeardown?.()
    attempt.basemapTeardown = null
    attempt.provider = null
    attempt.basemapProviderStyle = null
  }

  private removeBasemapContribution(map: WorkspaceActivationMap): void {
    if (map.getLayer(MAPLIBRE_BASEMAP_RASTER_LAYER_ID) != null) {
      map.removeLayer(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)
    }
    if (map.getSource(MAPLIBRE_BASEMAP_SOURCE_ID) != null) {
      map.removeSource(MAPLIBRE_BASEMAP_SOURCE_ID)
    }
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
        this.applyBasemapPresentation(attempt)
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
    this.releaseBasemapProvider(attempt)
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

/**
 * The provider viewport for the live workspace map.
 *
 * Read from the map's own camera. A map that cannot report bounds yet describes
 * the whole world, which is what it is actually showing at that point rather
 * than an invented extent.
 */
function readWorkspaceMapViewport(map: WorkspaceActivationMap): BasemapViewport {
  const bounds = (
    map as unknown as {
      getBounds?(): {
        getWest(): number
        getSouth(): number
        getEast(): number
        getNorth(): number
      }
    }
  ).getBounds?.()
  // A map whose camera is not attached yet reports no zoom; that is the same
  // "nothing known yet" case as no bounds.
  let zoom = Number.NaN
  try {
    zoom = map.getZoom()
  } catch {
    zoom = Number.NaN
  }
  if (!bounds || !Number.isFinite(zoom)) {
    return { west: -180, south: -85, east: 180, north: 85, zoom: 0 }
  }
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
    zoom,
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
  return typeof event === 'object'
    && event !== null
    && 'sourceId' in event
    && event.sourceId === MAPLIBRE_BASEMAP_SOURCE_ID
}

function mapError(event: unknown): Error {
  if (event instanceof Error) return event
  if (typeof event === 'string' && event.length > 0) return new Error(event)
  if (typeof event === 'object' && event !== null && 'message' in event
    && typeof event.message === 'string' && event.message.length > 0) {
    return new Error(event.message)
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
