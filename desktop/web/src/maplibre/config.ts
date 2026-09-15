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

/** A local style used while a map-backed surface acquires its rendering context. */
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

export interface MapLibreBasemapContribution {
  readonly sourceId: typeof MAPLIBRE_BASEMAP_SOURCE_ID
  readonly source: {
    readonly type: 'raster'
    readonly tiles: string[]
    readonly tileSize: 256
    readonly attribution: string
    readonly maxzoom: typeof MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM
  }
  readonly layer: {
    readonly id: typeof MAPLIBRE_BASEMAP_RASTER_LAYER_ID
    readonly type: 'raster'
    readonly source: typeof MAPLIBRE_BASEMAP_SOURCE_ID
    readonly minzoom: 0
  }
}

/**
 * Returns the remote basemap contribution separately from the local map style
 * so callers can defer every network-backed source until they are admitted.
 */
export function createMapLibreBasemapContribution(
  preferredStyle: BasemapStyle,
): MapLibreBasemapContribution {
  const source = getBasemapSourceDefinition(normalizeBasemapStyle(preferredStyle))
  return {
    sourceId: MAPLIBRE_BASEMAP_SOURCE_ID,
    source: {
      type: 'raster',
      tiles: source.tiles,
      tileSize: 256,
      attribution: source.attribution,
      maxzoom: MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM,
    },
    layer: {
      id: MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      type: 'raster',
      source: MAPLIBRE_BASEMAP_SOURCE_ID,
      minzoom: 0,
    },
  }
}

export function createMapLibreBasemapStyle(
  preferredStyle: BasemapStyle,
): MapLibreStyleDefinition {
  const emptyStyle = createMapLibreEmptyStyle()
  const contribution = createMapLibreBasemapContribution(preferredStyle)

  return {
    ...emptyStyle,
    sources: {
      [contribution.sourceId]: contribution.source,
    },
    layers: [
      ...emptyStyle.layers,
      contribution.layer,
      // Keep the raster layer visible beyond the source max zoom so
      // MapLibre can overzoom tiles while the canvas camera continues
      // to track the scene exactly at high zoom levels.
    ],
  }
}
