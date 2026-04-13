import type { MapLibreApi } from '../components/canvas/maplibre-loader'

export interface LoadedMapLibreContourApi {
  readonly DemSource: new (options: {
    url: string
    cacheSize?: number
    id?: string
    encoding?: 'terrarium' | 'mapbox'
    maxzoom: number
    timeoutMs?: number
    worker?: boolean
  }) => {
    readonly sharedDemProtocolUrl: string
    setupMaplibre: (maplibre: Pick<MapLibreApi, 'addProtocol'>) => void
    contourProtocolUrl: (options: {
      thresholds: Record<number, number | number[]>
      elevationKey?: string
      levelKey?: string
      contourLayer?: string
      overzoom?: number
    }) => string
  }
}

export async function loadMapLibreContourApi(): Promise<LoadedMapLibreContourApi> {
  // maplibre-contour publishes a broken package export for Vite in this repo;
  // keep the install-layout workaround isolated behind one local adapter.
  // @ts-expect-error maplibre-contour does not publish typings for its dist entrypoint.
  const module = await import('../../node_modules/maplibre-contour/dist/index.mjs')
  const normalized = module as unknown as { default?: LoadedMapLibreContourApi }
  return normalized.default ?? (module as unknown as LoadedMapLibreContourApi)
}
