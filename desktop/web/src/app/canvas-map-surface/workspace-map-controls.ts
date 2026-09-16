import type { MapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import { createMapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import {
  createMapLibreBasemapContribution,
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
} from '../../maplibre/config'
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
  readonly signal: AbortSignal
  readonly snapshot: WorkspaceMapSnapshot
  presentation: WorkspaceBasemapPresentation
  appliedBasemapStyle: WorkspaceBasemapPresentation['basemapStyle'] | null
  map: WorkspaceActivationMap | null
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
  readonly container: HTMLElement
  readonly surface?: MapLibreSurfaceAdapter<MapLibreMapInstance>
  readonly logError?: (message?: unknown, ...optionalParams: unknown[]) => void
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
  ): Promise<WorkspaceActivationMap> {
    const ownedSnapshot = captureMapSnapshot(snapshot)
    const previous = this.attempt
    if (previous && !previous.settled) {
      this.rejectAttempt(previous, abortError())
    } else {
      this.releaseAttempt(previous)
    }
    this.surface.attach(this.options.container)

    return new Promise<WorkspaceActivationMap>((resolve, reject) => {
      const attempt: WorkspaceMapAttempt = {
        signal,
        snapshot: ownedSnapshot,
        presentation: workspaceBasemapPresentationFromSnapshot(ownedSnapshot),
        appliedBasemapStyle: null,
        map: null,
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
        ),
        onCreate: (context) => {
          const map = context.map as WorkspaceActivationMap
          attempt.map = map
          const isLive = () => !attempt.released && !attempt.signal.aborted && context.isCurrent()
          const reportMapError = (event: unknown) => {
            if (!isLive()) return
            if (attempt.admitted && isPassiveBasemapError(event)) {
              this.logError('Passive MapLibre workspace basemap error:', event)
              return
            }
            const error = mapError(event)
            if (!attempt.admitted) {
              this.rejectAttempt(attempt, error)
              return
            }
            attempt.pendingFailure = error
            attempt.failureReporter?.(error)
          }
          const handleContextLoss = (event?: unknown) => {
            const error = contextLossError(event)
            if (!isLive()) return
            if (!attempt.admitted) {
              this.rejectAttempt(attempt, error)
              return
            }
            attempt.pendingFailure = error
            attempt.failureReporter?.(error)
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
              this.applyBasemapPresentation(attempt)
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

  releaseMap(map: WorkspaceActivationMap): void {
    const attempt = this.attempt
    if (!attempt || attempt.map !== map) return
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

  private applyBasemapPresentation(attempt: WorkspaceMapAttempt): void {
    const { map, snapshot, presentation } = attempt
    if (!map) return
    if (snapshot.placementStatus !== 'confirmed' || !presentation.basemapVisible) {
      this.removeBasemapContribution(map)
      attempt.appliedBasemapStyle = null
      return
    }
    const contribution = createMapLibreBasemapContribution(presentation.basemapStyle)
    const layerExists = map.getLayer(MAPLIBRE_BASEMAP_RASTER_LAYER_ID) != null
    const sourceExists = map.getSource(MAPLIBRE_BASEMAP_SOURCE_ID) != null
    if (layerExists && sourceExists && attempt.appliedBasemapStyle === presentation.basemapStyle) {
      map.setPaintProperty?.(
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        'raster-opacity',
        presentation.basemapOpacity,
      )
      return
    }
    this.removeBasemapContribution(map)
    if (map.getSource(contribution.sourceId) == null) {
      map.addSource(contribution.sourceId, contribution.source as Record<string, unknown>)
    }
    if (map.getLayer(contribution.layer.id) == null) {
      const order = map.getLayersOrder()
      const backgroundIndex = order.indexOf(MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID)
      const beforeId = backgroundIndex >= 0 ? order[backgroundIndex + 1] : order[0]
      if (beforeId) {
        map.addLayer(contribution.layer as unknown as Record<string, unknown>, beforeId)
      } else {
        map.addLayer(contribution.layer as unknown as Record<string, unknown>)
      }
    }
    attempt.appliedBasemapStyle = presentation.basemapStyle
    map.setPaintProperty?.(
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      'raster-opacity',
      presentation.basemapOpacity,
    )
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
        if (restoreScene) attempt.styleRestorer?.()
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
      createMapLayerStackDescriptors([]),
    )
  }

  private reportRestorationFailure(attempt: WorkspaceMapAttempt, error: unknown): void {
    if (attempt.released || attempt.failureReported) return
    attempt.failureReported = true
    attempt.pendingStyleRestore = false
    attempt.pendingPresentationSync = false
    const failure = mapError(error)
    attempt.pendingFailure = failure
    attempt.failureReporter?.(failure)
  }

  private rejectAttempt(attempt: WorkspaceMapAttempt, error: unknown): void {
    if (attempt.settled) return
    attempt.settled = true
    attempt.signal.removeEventListener('abort', attempt.abort)
    attempt.reject(error)
    this.releaseAttempt(attempt)
  }

  private releaseAttempt(attempt: WorkspaceMapAttempt | null): void {
    if (!attempt || attempt.released) return
    attempt.released = true
    attempt.signal.removeEventListener('abort', attempt.abort)
    if (this.attempt === attempt) this.attempt = null
    // Host/Surface Adapter performs listener cleanup, observer disconnect, and
    // final map removal. No app-layer code calls map.remove().
    this.surface.destroy()
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
  return new DOMException('Shared workspace map acquisition was cancelled.', 'AbortError')
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
  if (
    typeof event === 'object'
    && event !== null
    && 'error' in event
    && event.error instanceof Error
  ) {
    return event.error
  }
  return new Error('MapLibre failed while preparing the shared workspace.')
}
