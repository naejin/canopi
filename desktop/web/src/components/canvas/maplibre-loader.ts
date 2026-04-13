import type { StyleSpecification } from 'maplibre-gl'

export interface MapLibreMapConstructorOptions {
  container: HTMLElement
  style: string | StyleSpecification
  center?: [number, number]
  zoom?: number
  bearing?: number
  attributionControl: boolean
  interactive: boolean
  pitchWithRotate: boolean
  dragRotate: boolean
  touchZoomRotate: boolean
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
  on(type: 'load' | 'error' | 'sourcedata', listener: (event?: unknown) => void): void
  off(type: 'load' | 'error' | 'sourcedata', listener: (event?: unknown) => void): void
  loaded?(): boolean
  isStyleLoaded?(): boolean
  isSourceLoaded?(id: string): boolean
  addSource(id: string, source: Record<string, unknown>): void
  getSource(id: string): { setData(data: unknown): void } | undefined
  removeSource(id: string): void
  addLayer(layer: Record<string, unknown>): void
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
    mapLibreModulePromise = import('maplibre-gl')
      .then((module) => {
        const normalized = module as unknown as { default?: MapLibreApi }
        return normalized.default ?? (module as unknown as MapLibreApi)
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
