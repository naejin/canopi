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
  private cleared = false

  constructor(
    private readonly map: MapLibreMapInstance,
    private readonly logError: MapLibreSurfaceLogError,
  ) {}

  on(type: string, listener: MapLibreSurfaceEventListener): void {
    const map = this.map as unknown as EventCapableMap
    map.on(type, listener)
    this.addCleanup(() => {
      map.off(type, listener)
    })
  }

  addCleanup(cleanup: () => void): void {
    if (this.cleared) {
      this.runCleanup(cleanup)
      return
    }
    this.cleanups.push(cleanup)
  }

  clear(): void {
    if (this.cleared) return
    this.cleared = true
    for (let i = this.cleanups.length - 1; i >= 0; i -= 1) {
      const cleanup = this.cleanups[i]
      if (cleanup) this.runCleanup(cleanup)
    }
    this.cleanups.length = 0
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
