import type { StyleSpecification } from 'maplibre-gl'

export const MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID = 'basemap-background'
export const MAPLIBRE_SATELLITE_SOURCE_ID = 'canopi-satellite'
export const MAPLIBRE_SATELLITE_LAYER_ID = 'satellite-raster'

/**
 * The local style every map starts from: one background layer and no remote
 * sources. The Basemap (vector) and Satellite (raster) are installed onto it
 * at runtime, so switching them never calls `setStyle()`.
 */
export function createMapLibreEmptyStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
        type: 'background',
        paint: { 'background-color': '#f3efe4' },
      },
    ],
  }
}
