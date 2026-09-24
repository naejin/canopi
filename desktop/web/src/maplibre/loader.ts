import type { StyleSpecification } from 'maplibre-gl'

export interface MapLibreMapConstructorOptions {
  container: HTMLElement
  style: string | StyleSpecification
  center?: [number, number]
  zoom?: number
  minZoom?: number
  maxZoom?: number
  bearing?: number
  renderWorldCopies?: boolean
  canvasContextAttributes?: WebGLContextAttributes
  attributionControl?: false | { compact?: boolean }
  interactive: boolean
  pitchWithRotate: boolean
  dragRotate: boolean
  touchZoomRotate: boolean
  /**
   * MapLibre's request seam, used to authenticate official provider tiles with
   * the live session. Set once at creation, because a map's transform is a
   * construction option; it closes over the map's own credential owner so a
   * session renewal reaches requests without touching the style or the source.
   */
  transformRequest?: (url: string) => MapLibreRequestParameters
}

export interface MapLibreRequestParameters {
  url: string
}

export interface MapLibreGetResourceResponse<T = ArrayBuffer> {
  data: T
}

export interface MapLibreMapInstance {
  jumpTo(options: { center: [number, number]; zoom: number; bearing: number }): void
  resize(): void
  remove(): void
  on(type: 'load' | 'style.load' | 'error' | 'sourcedata' | 'idle' | 'move' | 'moveend' | 'resize' | 'webglcontextlost' | 'webglcontextrestored', listener: (event?: unknown) => void): void
  off(type: 'load' | 'style.load' | 'error' | 'sourcedata' | 'idle' | 'move' | 'moveend' | 'resize' | 'webglcontextlost' | 'webglcontextrestored', listener: (event?: unknown) => void): void
  project?(lnglat: [number, number]): { x: number; y: number }
  getPitch?(): number
  getZoom?(): number
  getMinZoom?(): number
  getMaxZoom?(): number
  getCenter?(): { lng: number; lat: number }
  getCanvas?(): HTMLCanvasElement
  getBounds?(): {
    getWest(): number
    getSouth(): number
    getEast(): number
    getNorth(): number
  }
  loaded?(): boolean
  isStyleLoaded?(): boolean
  isSourceLoaded?(id: string): boolean
  addSource(id: string, source: Record<string, unknown>): void
  getSource(id: string): { setData(data: unknown): void } | undefined
  removeSource(id: string): void
  addLayer(layer: Record<string, unknown>, beforeId?: string): void
  getLayersOrder(): string[]
  moveLayer(id: string, beforeId?: string): void
  setPaintProperty?(layerId: string, name: string, value: unknown): void
  getLayer(id: string): unknown
  removeLayer(id: string): void
}

export interface MapLibreApi {
  Map: new (options: MapLibreMapConstructorOptions) => MapLibreMapInstance
  addProtocol(
    id: string,
    protocol: (
      requestParameters: MapLibreRequestParameters,
      abortController: AbortController,
    ) => Promise<MapLibreGetResourceResponse>,
  ): void
}

let mapLibreModulePromise: Promise<MapLibreApi> | null = null

export function loadMapLibreModule(): Promise<MapLibreApi> {
  if (!mapLibreModulePromise) {
    mapLibreModulePromise = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
    ])
      .then(([module, worker]) => {
        module.setWorkerUrl(worker.default)
        return module as unknown as MapLibreApi
      })
      .catch((error) => {
        mapLibreModulePromise = null
        throw error
      })
  }
  return mapLibreModulePromise
}

export async function loadMapLibre() {
  return loadMapLibreModule()
}
