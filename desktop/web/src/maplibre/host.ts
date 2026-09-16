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

export interface MapLibreHostResizeObserver {
  observe(target: Element): void
  disconnect(): void
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
  onResize?(context: MapLibreHostContext): void
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
  readonly rollbackConstructorMutations: () => void
}

interface CreatedMapLibreMap {
  readonly map: MapLibreMapInstance
  readonly rollbackConstructorMutations: () => void
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
      this.mapContext = this.createContext(
        request,
        this.mapContext.maplibre,
        {
          map: this.mapContext.map,
          rollbackConstructorMutations: this.mapContext.rollbackConstructorMutations,
        },
        this.mapContext.generation,
      )
      return
    }
    void this.ensureMap()
  }

  resize(): void {
    const context = this.mapContext
    if (!context?.isCurrent()) return
    context.map.resize()
    context.request.onResize?.(context)
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

      const createdMap = this.createMapWithContainerRollback(currentRequest, maplibre, container)
      const latestRequest = this.currentPendingRequest(key, container, generation)
      if (!latestRequest) {
        this.removeMap(createdMap)
        return
      }

      const context = this.createContext(latestRequest, maplibre, createdMap, generation)
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
    createdMap: CreatedMapLibreMap,
    generation: number,
  ): CurrentMapLibreHostContext {
    const { map, rollbackConstructorMutations } = createdMap
    return {
      key: request.key,
      map,
      maplibre,
      request,
      generation,
      rollbackConstructorMutations,
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

  private createMapWithContainerRollback(
    request: MapLibreHostRequest,
    maplibre: MapLibreApi,
    container: HTMLElement,
  ): CreatedMapLibreMap {
    const existingChildren = new Set(Array.from(container.children))
    const existingClasses = new Set(Array.from(container.classList))
    try {
      const map = request.createMap(maplibre, container, this.preservedViewState)
      return {
        map,
        rollbackConstructorMutations: this.createConstructorMutationRollback(
          container,
          existingChildren,
          existingClasses,
        ),
      }
    } catch (error) {
      this.createConstructorMutationRollback(container, existingChildren, existingClasses)()
      throw error
    }
  }

  private createConstructorMutationRollback(
    container: HTMLElement,
    existingChildren: ReadonlySet<Element>,
    existingClasses: ReadonlySet<string>,
  ): () => void {
    const constructorChildren = new Set(
      Array.from(container.children).filter((child) => !existingChildren.has(child)),
    )
    const constructorClasses = Array.from(container.classList)
      .filter((className) => !existingClasses.has(className))
    let rolledBack = false

    return () => {
      if (rolledBack) return
      rolledBack = true

      for (const child of constructorChildren) {
        if (child.parentElement !== container) continue
        try {
          child.remove()
        } catch (error) {
          this.logCleanupError('Failed to remove MapLibre container child after create failure:', error)
        }
      }
      for (const className of constructorClasses) {
        try {
          container.classList.remove(className)
        } catch (error) {
          this.logCleanupError('Failed to remove MapLibre container class after create failure:', error)
        }
      }
    }
  }

  private removeMap(createdMap: CreatedMapLibreMap): void {
    try {
      createdMap.map.remove()
    } finally {
      createdMap.rollbackConstructorMutations()
    }
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
      this.removeMap(context)
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
        this.removeMap(context)
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
    const log = this.deps.logError ?? console.error
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
