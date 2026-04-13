export interface MapLibreMapConstructorOptions {
  container: HTMLElement
  style: string
  attributionControl: boolean
  interactive: boolean
  pitchWithRotate: boolean
  dragRotate: boolean
  touchZoomRotate: boolean
}

export interface MapLibreMapInstance {
  jumpTo(options: { center: [number, number]; zoom: number; bearing: number }): void
  resize(): void
  remove(): void
  on(type: 'load' | 'error', listener: (event?: unknown) => void): void
  off(type: 'load' | 'error', listener: (event?: unknown) => void): void
  loaded?(): boolean
  addSource(id: string, source: Record<string, unknown>): void
  getSource(id: string): { setData(data: unknown): void } | undefined
  removeSource(id: string): void
  addLayer(layer: Record<string, unknown>): void
  getLayer(id: string): unknown
  removeLayer(id: string): void
}

export interface MapLibreApi {
  Map: new (options: MapLibreMapConstructorOptions) => MapLibreMapInstance
}

let mapLibreModulePromise: Promise<MapLibreApi> | null = null
let mapLibreCssPromise: Promise<unknown> | null = null

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

export function loadMapLibreCss(): Promise<unknown> {
  if (!mapLibreCssPromise) {
    mapLibreCssPromise = import('maplibre-gl/dist/maplibre-gl.css').catch((error) => {
      mapLibreCssPromise = null
      throw error
    })
  }
  return mapLibreCssPromise
}

export async function loadMapLibre() {
  const [api] = await Promise.all([
    loadMapLibreModule(),
    loadMapLibreCss(),
  ])
  return api
}
