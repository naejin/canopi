import { logMapError } from './redact-credentials'
import {
  loadMapLibre as defaultLoadMapLibre,
  type MapLibreApi,
  type MapLibreMapInstance,
} from './loader'

export type { MapLibreApi, MapLibreMapInstance } from './loader'

export interface MapLibreHostViewState {
  readonly center?: [number, number]
  readonly zoom?: number
  readonly bearing?: number
}

interface MapLibreHostResizeObserver {
  observe(target: Element): void
  disconnect(): void
}

/** The container's CSS size, as MapLibre reads it (clientWidth, clientHeight). */
export interface MapLibreHostSize {
  readonly width: number
  readonly height: number
}

export interface MapLibreHostContext {
  readonly key: string
  readonly map: MapLibreMapInstance
  readonly maplibre: MapLibreApi
  readonly preservedViewState: MapLibreHostViewState | null
  isCurrent(): boolean
}

export interface MapLibreHostRequest {
  readonly key: string
  createMap(
    maplibre: MapLibreApi,
    container: HTMLElement,
    preservedViewState: MapLibreHostViewState | null,
  ): MapLibreMapInstance
  captureViewState?(context: MapLibreHostContext): MapLibreHostViewState | null
  onCreate?(context: MapLibreHostContext): void
  /**
   * The request's own resize owner (spec §1.1 "Resize"): the host reports the container's new size and never resizes a map itself.
   * The workspace request hands the size to its camera driver; the World map, which has no driver, resizes its map.
   */
  onResize?(context: MapLibreHostContext, size: MapLibreHostSize): void
  onDestroy?(context: MapLibreHostContext): void
  onCreateError?(error: unknown): void
}

export interface MapLibreHost {
  attach(container: HTMLElement): void
  requestMap(request: MapLibreHostRequest): void
  resize(): void
  clearMap(): void
  destroy(): void
  current(): MapLibreHostContext | null
}

export interface MapLibreHostDeps {
  readonly loadMapLibre?: () => Promise<MapLibreApi>
  readonly createResizeObserver?: (callback: ResizeObserverCallback) => MapLibreHostResizeObserver | null
  readonly logError?: (message?: unknown, ...optionalParams: unknown[]) => void
}

interface CurrentMapLibreHostContext extends MapLibreHostContext {
  readonly generation: number
  readonly request: MapLibreHostRequest
  /** Removes what the map's creation added to the container. */
  readonly rollback: () => void
}

/**
 * What a creation added to the container since `before`. MapLibre removes its own canvas, controls and class only when
 * its painter fails or remove() completes; a later constructor step, or a request's setup after the constructor, that
 * throws leaves them behind, and a Retry would stack a second map in the container.
 */
function containerRollback(container: HTMLElement, before: { children: Set<Element>, classes: Set<string> }): () => void {
  const children = Array.from(container.children).filter((child) => !before.children.has(child))
  const classes = Array.from(container.classList).filter((name) => !before.classes.has(name))
  return () => {
    for (const child of children) if (child.parentElement === container) child.remove()
    container.classList.remove(...classes)
  }
}

function removeMap(map: MapLibreMapInstance, rollback: () => void): void {
  try {
    map.remove()
  } finally {
    rollback()
  }
}

export function createMapLibreHost(deps: MapLibreHostDeps = {}): MapLibreHost {
  return new ImperativeMapLibreHost(deps)
}

class ImperativeMapLibreHost implements MapLibreHost {
  private readonly deps: MapLibreHostDeps
  private container: HTMLElement | null = null
  private request: MapLibreHostRequest | null = null
  private mapContext: CurrentMapLibreHostContext | null = null
  private resizeObserver: MapLibreHostResizeObserver | null = null
  private loadingKey: string | null = null
  private generation = 0
  private preservedViewState: MapLibreHostViewState | null = null

  constructor(deps: MapLibreHostDeps) {
    this.deps = deps
  }

  attach(container: HTMLElement): void {
    if (this.container === container) return
    this.destroyCurrentMap()
    this.container = container
    void this.ensureMap()
  }

  requestMap(request: MapLibreHostRequest): void {
    this.request = request
    if (this.mapContext && this.mapContext.key !== request.key) {
      this.destroyCurrentMap()
    }
    if (this.mapContext?.key === request.key) {
      const { maplibre, map, generation, rollback } = this.mapContext
      this.mapContext = this.createContext(request, maplibre, map, generation, rollback)
      return
    }
    void this.ensureMap()
  }

  resize(): void {
    const context = this.mapContext
    const container = this.container
    if (!context?.isCurrent() || !container) return
    context.request.onResize?.(context, { width: container.clientWidth, height: container.clientHeight })
  }

  clearMap(): void {
    this.destroyCurrentMap()
  }

  destroy(): void {
    this.container = null
    this.destroyCurrentMap()
  }

  current(): MapLibreHostContext | null {
    return this.mapContext
  }

  private async ensureMap(): Promise<void> {
    const request = this.request
    const container = this.container
    if (!request || !container) return
    if (this.mapContext?.key === request.key) return
    if (this.loadingKey === request.key) return

    const key = request.key
    const generation = this.generation + 1
    this.generation = generation
    this.loadingKey = key

    try {
      const maplibre = await this.loadMapLibre()
      const currentRequest = this.currentPendingRequest(key, container, generation)
      if (!currentRequest) return

      const before = { children: new Set(container.children), classes: new Set(container.classList) }
      let map: MapLibreMapInstance
      try {
        map = currentRequest.createMap(maplibre, container, this.preservedViewState)
      } catch (error) {
        containerRollback(container, before)()
        throw error
      }
      const rollback = containerRollback(container, before)
      const latestRequest = this.currentPendingRequest(key, container, generation)
      if (!latestRequest) {
        removeMap(map, rollback)
        return
      }

      const context = this.createContext(latestRequest, maplibre, map, generation, rollback)
      this.mapContext = context
      this.loadingKey = null
      this.installResizeObserver(context, container)
      latestRequest.onCreate?.(context)
    } catch (error) {
      const currentRequest = this.currentPendingRequest(key, container, generation)
      if (!currentRequest) return
      this.discardFailedCurrentMap(generation)
      this.loadingKey = null
      currentRequest.onCreateError?.(error)
    }
  }

  private createContext(
    request: MapLibreHostRequest,
    maplibre: MapLibreApi,
    map: MapLibreMapInstance,
    generation: number,
    rollback: () => void,
  ): CurrentMapLibreHostContext {
    return {
      key: request.key,
      map,
      maplibre,
      request,
      generation,
      rollback,
      preservedViewState: this.preservedViewState,
      isCurrent: () => this.mapContext?.map === map && this.generation === generation,
    }
  }

  private currentPendingRequest(
    key: string,
    container: HTMLElement,
    generation: number,
  ): MapLibreHostRequest | null {
    const request = this.request
    if (
      !request
      || request.key !== key
      || this.container !== container
      || this.generation !== generation
    ) {
      return null
    }
    return request
  }

  private destroyCurrentMap(): void {
    this.generation += 1
    this.loadingKey = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null

    const context = this.mapContext
    this.mapContext = null
    if (!context) return

    this.capturePreservedViewState(context)
    try {
      context.request.onDestroy?.(context)
    } finally {
      removeMap(context.map, context.rollback)
    }
  }

  private discardFailedCurrentMap(generation: number): void {
    const context = this.mapContext
    if (!context || context.generation !== generation) return

    this.generation += 1
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.mapContext = null
    try {
      context.request.onDestroy?.(context)
    } catch (error) {
      this.logError('Failed to clean up MapLibre map after create failure:', error)
    } finally {
      try {
        removeMap(context.map, context.rollback)
      } catch (error) {
        this.logCleanupError('Failed to remove MapLibre map after create failure:', error)
      }
    }
  }

  private capturePreservedViewState(context: CurrentMapLibreHostContext): void {
    const capture = context.request.captureViewState
    if (!capture) return
    try {
      this.preservedViewState = capture(context)
    } catch (error) {
      this.logError('Failed to preserve MapLibre view state:', error)
    }
  }

  private installResizeObserver(
    context: CurrentMapLibreHostContext,
    container: HTMLElement,
  ): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = this.createResizeObserver(() => {
      if (!context.isCurrent()) return
      this.resize()
    })
    this.resizeObserver?.observe(container)
  }

  private createResizeObserver(
    callback: ResizeObserverCallback,
  ): MapLibreHostResizeObserver | null {
    if (this.deps.createResizeObserver) return this.deps.createResizeObserver(callback)
    if (typeof ResizeObserver === 'undefined') return null
    return new ResizeObserver(callback)
  }

  private loadMapLibre(): Promise<MapLibreApi> {
    return (this.deps.loadMapLibre ?? defaultLoadMapLibre)()
  }

  private logError(message?: unknown, ...optionalParams: unknown[]): void {
    const log = this.deps.logError ?? logMapError
    log(message, ...optionalParams)
  }

  private logCleanupError(message: unknown, error: unknown): void {
    try {
      this.logError(message, error)
    } catch {
      // Preserve the MapLibre construction failure when diagnostics fail.
    }
  }
}
