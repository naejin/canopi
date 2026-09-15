import type { MapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import { createMapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import {
  createMapLibreBasemapContribution,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
} from '../../maplibre/config'
import {
  createWorkspaceMapLibreMap,
  type WorkspaceMapSnapshot,
} from '../../maplibre/workspace-map'
import type { MapLibreMapInstance } from '../../maplibre/loader'
import type {
  WorkspaceActivationMap,
  WorkspaceActivationMapControls,
} from './workspace-activation'

interface WorkspaceMapAttempt {
  readonly signal: AbortSignal
  map: WorkspaceActivationMap | null
  settled: boolean
  released: boolean
  admitted: boolean
  pendingFailure: Error | null
  failureReporter: ((error: Error) => void) | null
  abort: () => void
  resolve: (map: WorkspaceActivationMap) => void
  reject: (error: unknown) => void
}

export interface WorkspaceActivationMapControlsOptions {
  readonly container: HTMLElement
  readonly snapshot: WorkspaceMapSnapshot
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

  createMap(signal: AbortSignal): Promise<WorkspaceActivationMap> {
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
        map: null,
        settled: false,
        released: false,
        admitted: false,
        pendingFailure: null,
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
          this.options.snapshot,
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
          const admit = () => {
            if (!isLive() || attempt.settled) return
            // The local style is admitted before a remote source is attached.
            // MapLibre may synchronously publish a passive source error while
            // addSource runs; only a thrown configuration error rejects this map.
            attempt.admitted = true
            try {
              this.addBasemapContribution(map)
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
          context.lifetime.on('style.load', admit)
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

  private addBasemapContribution(map: WorkspaceActivationMap): void {
    const snapshot = this.options.snapshot
    if (snapshot.placementStatus !== 'confirmed' || !snapshot.basemapVisible) return
    const contribution = createMapLibreBasemapContribution(snapshot.basemapStyle)
    if (map.getSource(contribution.sourceId) == null) {
      map.addSource(contribution.sourceId, contribution.source as Record<string, unknown>)
    }
    if (map.getLayer(contribution.layer.id) == null) {
      map.addLayer(contribution.layer as unknown as Record<string, unknown>)
    }
    map.setPaintProperty?.(
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      'raster-opacity',
      snapshot.basemapOpacity,
    )
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
