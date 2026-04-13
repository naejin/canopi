import type { StyleSpecification } from 'maplibre-gl'

export type MapLibreStyleDefinition = string | StyleSpecification

export const MAPLIBRE_BASEMAP_SOURCE_ID = 'canopi-basemap-raster'
export const MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID = 'basemap-background'
export const MAPLIBRE_BASEMAP_RASTER_LAYER_ID = 'openstreetmap-raster'
export const MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM = 19
export const REMOTE_BASEMAP_TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OPENSTREETMAP_ATTRIBUTION = '&copy; OpenStreetMap contributors'

export function createDefaultMapLibreBasemapStyle(
  tileUrlTemplate: string,
): MapLibreStyleDefinition {
  return {
    version: 8,
    sources: {
      [MAPLIBRE_BASEMAP_SOURCE_ID]: {
        type: 'raster',
        tiles: [tileUrlTemplate],
        tileSize: 256,
        attribution: OPENSTREETMAP_ATTRIBUTION,
        maxzoom: MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM,
      },
    },
    layers: [
      {
        id: MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
        type: 'background',
        paint: {
          'background-color': '#f3efe4',
        },
      },
      {
        id: MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        type: 'raster',
        source: MAPLIBRE_BASEMAP_SOURCE_ID,
        minzoom: 0,
        // Keep the raster layer visible beyond the source max zoom so
        // MapLibre can overzoom tiles while the canvas camera continues
        // to track the scene exactly at high zoom levels.
      },
    ],
  }
}
