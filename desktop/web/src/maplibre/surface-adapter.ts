import {
  createMapLibreHost,
  type MapLibreHost,
  type MapLibreHostContext,
  type MapLibreHostDeps,
  type MapLibreHostViewState,
} from './host'
import type { MapLibreApi, MapLibreMapInstance } from './loader'

export type { MapLibreHostViewState } from './host'

type MapLibreSurfaceEventListener = (event?: unknown) => void
type MapLibreSurfaceLogError = (message?: unknown, ...optionalParams: unknown[]) => void

interface EventCapableMap {
  on(type: string, listener: MapLibreSurfaceEventListener): void
  off(type: string, listener: MapLibreSurfaceEventListener): void
}

export interface MapLibreSurfaceLifetime {
  on(type: string, listener: MapLibreSurfaceEventListener): void
  /** Unregister a listener registered through `on` before lifetime clear. */
  off?(type: string, listener: MapLibreSurfaceEventListener): void
  addCleanup(cleanup: () => void): void
  clear(): void
}

export interface MapLibreSurfaceContext<TMap extends MapLibreMapInstance> {
  readonly key: string
  readonly map: TMap
  readonly maplibre: MapLibreApi
  readonly preservedViewState: MapLibreHostViewState | null
  readonly lifetime: MapLibreSurfaceLifetime
  isCurrent(): boolean
}

export interface MapLibreSurfaceRequest<TMap extends MapLibreMapInstance> {
  readonly key: string
  createMap(
    maplibre: MapLibreApi,
    container: HTMLElement,
    preservedViewState: MapLibreHostViewState | null,
  ): TMap
  captureViewState?(context: MapLibreSurfaceContext<TMap>): MapLibreHostViewState | null
  onCreate?(context: MapLibreSurfaceContext<TMap>): void
  onResize?(context: MapLibreSurfaceContext<TMap>): void
  onDestroy?(context: MapLibreSurfaceContext<TMap>): void
  onCreateError?(error: unknown): void
}

export interface MapLibreSurfaceAdapter<TMap extends MapLibreMapInstance> {
  readonly map: TMap | null
  readonly maplibre: MapLibreApi | null
  attach(container: HTMLElement): void
  requestMap(request: MapLibreSurfaceRequest<TMap>): void
  resize(): void
  clearMap(): void
  destroy(): void
  current(): MapLibreSurfaceContext<TMap> | null
}

export function createMapLibreSurfaceAdapter<
  TMap extends MapLibreMapInstance = MapLibreMapInstance,
>(
  deps: MapLibreHostDeps = {},
): MapLibreSurfaceAdapter<TMap> {
  return new HostedMapLibreSurfaceAdapter<TMap>(deps)
}

class HostedMapLibreSurfaceAdapter<TMap extends MapLibreMapInstance>
  implements MapLibreSurfaceAdapter<TMap> {
  private readonly host: MapLibreHost
  private readonly logError: MapLibreSurfaceLogError
  private currentMap: TMap | null = null
  private currentLifetime: MapLibreSurfaceLifetimeRegistry | null = null

  constructor(deps: MapLibreHostDeps) {
    this.host = createMapLibreHost(deps)
    this.logError = deps.logError ?? console.error
  }

  get map(): TMap | null {
    return this.current()?.map ?? null
  }

  get maplibre(): MapLibreApi | null {
    return this.current()?.maplibre ?? null
  }

  attach(container: HTMLElement): void {
    this.host.attach(container)
  }

  requestMap(request: MapLibreSurfaceRequest<TMap>): void {
    this.host.requestMap({
      key: request.key,
      createMap: (maplibre, container, preservedViewState) =>
        request.createMap(maplibre, container, preservedViewState),
      captureViewState: request.captureViewState
        ? (context) => request.captureViewState!(this.contextFromHost(context))
        : undefined,
      onCreate: (context) => {
        const map = context.map as TMap
        this.currentLifetime?.clear()
        this.currentMap = map
        this.currentLifetime = new MapLibreSurfaceLifetimeRegistry(map, this.logError)
        request.onCreate?.(this.contextFromHost(context))
      },
      onResize: request.onResize
        ? (context) => request.onResize!(this.contextFromHost(context))
        : undefined,
      onDestroy: (context) => {
        const surfaceContext = this.contextFromHost(context)
        try {
          this.currentLifetime?.clear()
          request.onDestroy?.(surfaceContext)
        } finally {
          if (this.currentMap === surfaceContext.map) {
            this.currentMap = null
            this.currentLifetime = null
          }
        }
      },
      onCreateError: request.onCreateError,
    })
  }

  resize(): void {
    this.host.resize()
  }

  clearMap(): void {
    this.host.clearMap()
  }

  destroy(): void {
    this.host.destroy()
  }

  current(): MapLibreSurfaceContext<TMap> | null {
    const context = this.host.current()
    return context ? this.contextFromHost(context) : null
  }

  private contextFromHost(
    context: MapLibreHostContext,
  ): MapLibreSurfaceContext<TMap> {
    const map = context.map as TMap
    return {
      key: context.key,
      map,
      maplibre: context.maplibre,
      preservedViewState: context.preservedViewState,
      lifetime: this.currentMap === map && this.currentLifetime
        ? this.currentLifetime
        : DETACHED_SURFACE_LIFETIME,
      isCurrent: () => context.isCurrent(),
    }
  }
}

class MapLibreSurfaceLifetimeRegistry implements MapLibreSurfaceLifetime {
  private readonly cleanups: Array<() => void> = []
  /**
   * Matching cleanup for each `on` registration, so explicit `off` releases
   * retained ownership as well as the live map listener.
   */
  private readonly eventCleanups = new Map<string, Array<{ listener: MapLibreSurfaceEventListener; cleanup: () => void; retained?: () => void }>>()
  private cleared = false

  constructor(
    private readonly map: MapLibreMapInstance,
    private readonly logError: MapLibreSurfaceLogError,
  ) {}

  on(type: string, listener: MapLibreSurfaceEventListener): void {
    const map = this.map as unknown as EventCapableMap
    map.on(type, listener)
    const registration: {
      listener: MapLibreSurfaceEventListener
      cleanup: () => void
      retained?: () => void
    } = {
      listener,
      cleanup: () => {
        map.off(type, listener)
      },
    }
    const bucket = this.eventCleanups.get(type) ?? []
    bucket.push(registration)
    this.eventCleanups.set(type, bucket)
    const retained = () => {
      registration.cleanup()
      this.dropEventRegistration(type, registration)
      // Drop this retained registration itself so later clear does not re-run it.
      const at = this.cleanups.indexOf(retained)
      if (at >= 0) this.cleanups.splice(at, 1)
    }
    registration.retained = retained
    this.addCleanup(retained)
  }

  off(type: string, listener: MapLibreSurfaceEventListener): void {
    const map = this.map as unknown as EventCapableMap
    map.off(type, listener)
    const bucket = this.eventCleanups.get(type)
    if (!bucket) return
    const index = bucket.findIndex((entry) => entry.listener === listener)
    if (index < 0) return
    const [registration] = bucket.splice(index, 1)
    if (bucket.length === 0) this.eventCleanups.delete(type)
    if (registration?.retained) {
      const at = this.cleanups.indexOf(registration.retained)
      if (at >= 0) this.cleanups.splice(at, 1)
    }
  }

  private dropEventRegistration(
    type: string,
    registration: { listener: MapLibreSurfaceEventListener; cleanup: () => void; retained?: () => void },
  ): void {
    const bucket = this.eventCleanups.get(type)
    if (!bucket) return
    const index = bucket.findIndex((entry) => entry === registration)
    if (index >= 0) bucket.splice(index, 1)
    if (bucket.length === 0) this.eventCleanups.delete(type)
  }

  addCleanup(cleanup: () => void): void {
    if (this.cleared) {
      this.runCleanup(cleanup)
      return
    }
    this.cleanups.push(cleanup)
  }

  clear(): void {
    this.cleared = true
    // Destructive drain: take ownership of the remaining cleanups first so a
    // cleanup that unregisters another registration cannot shift entries and
    // run a later cleanup twice.
    const pending = this.cleanups.splice(0)
    this.eventCleanups.clear()
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      this.runCleanup(pending[i]!)
    }
  }

  private runCleanup(cleanup: () => void): void {
    try {
      cleanup()
    } catch (error) {
      this.logError('Failed to clean up MapLibre surface resource:', error)
    }
  }
}

const DETACHED_SURFACE_LIFETIME: MapLibreSurfaceLifetime = {
  on: () => {},
  addCleanup: () => {},
  clear: () => {},
}
