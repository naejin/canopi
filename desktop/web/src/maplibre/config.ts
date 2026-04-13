import type { StyleSpecification } from 'maplibre-gl'
import type { BasemapStyle } from '../generated/contracts'

export type MapLibreStyleDefinition = string | StyleSpecification

export const MAPLIBRE_BASEMAP_SOURCE_ID = 'canopi-basemap-raster'
export const MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID = 'basemap-background'
export const MAPLIBRE_BASEMAP_RASTER_LAYER_ID = 'basemap-raster'
export const MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM = 19
export const REMOTE_BASEMAP_TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const MAPTILER_SATELLITE_TILESET_ID = 'satellite-v4'
const OPENSTREETMAP_ATTRIBUTION = '&copy; OpenStreetMap contributors'
const MAPTILER_ATTRIBUTION = '&copy; MapTiler &copy; OpenStreetMap contributors'

export function isBasemapStyleSupported(style: BasemapStyle): boolean {
  return style !== 'satellite' || Boolean(import.meta.env.VITE_MAPTILER_KEY)
}

export function normalizeBasemapStyle(style: string | null | undefined): BasemapStyle {
  if (style === 'satellite' && isBasemapStyleSupported('satellite')) return 'satellite'
  return 'street'
}

function getBasemapSourceDefinition(style: BasemapStyle): { attribution: string; tiles: string[] } {
  if (style === 'satellite') {
    const apiKey = import.meta.env.VITE_MAPTILER_KEY
    if (!apiKey) {
      return {
        attribution: OPENSTREETMAP_ATTRIBUTION,
        tiles: [REMOTE_BASEMAP_TILE_URL_TEMPLATE],
      }
    }
    return {
      attribution: MAPTILER_ATTRIBUTION,
      tiles: [`https://api.maptiler.com/tiles/${MAPTILER_SATELLITE_TILESET_ID}/{z}/{x}/{y}?key=${apiKey}`],
    }
  }

  return {
    attribution: OPENSTREETMAP_ATTRIBUTION,
    tiles: [REMOTE_BASEMAP_TILE_URL_TEMPLATE],
  }
}

export function createMapLibreBasemapStyle(
  preferredStyle: BasemapStyle,
): MapLibreStyleDefinition {
  const style = normalizeBasemapStyle(preferredStyle)
  const source = getBasemapSourceDefinition(style)

  return {
    version: 8,
    sources: {
      [MAPLIBRE_BASEMAP_SOURCE_ID]: {
        type: 'raster',
        tiles: source.tiles,
        tileSize: 256,
        attribution: source.attribution,
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
