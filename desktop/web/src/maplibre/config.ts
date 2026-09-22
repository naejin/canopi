import type { StyleSpecification } from 'maplibre-gl'
import type { BasemapStyle } from '../generated/contracts'
import {
  coerceBasemapStyle,
  resolveBasemapAvailability,
  type BasemapDescriptor,
  type BasemapProviderConfig,
} from './basemap-provider'

export type { BasemapDescriptor, BasemapProviderConfig }

export type MapLibreStyleDefinition = string | StyleSpecification

export const MAPLIBRE_BASEMAP_SOURCE_ID = 'canopi-basemap-raster'
export const MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID = 'basemap-background'
export const MAPLIBRE_BASEMAP_RASTER_LAYER_ID = 'basemap-raster'
export const MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM = 19
export const REMOTE_BASEMAP_TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export { MAPTILER_SATELLITE_TILESET_ID } from './basemap-provider'

/**
 * The provider configuration this build can offer.
 *
 * Only the build-time facts are read here; the device-local Google key is a
 * setting that reaches the provider through the caller, because reading it here
 * would make a persisted preference into a module-load-time constant.
 */
function buildProviderConfig(googleMapsApiKey?: string | null): BasemapProviderConfig {
  return {
    mapTilerKey: import.meta.env.VITE_MAPTILER_KEY,
    googleMapsApiKey,
  }
}

/**
 * Whether a style can render in this build.
 *
 * `satellite` without a MapTiler key is **not** supported, and that is a real
 * unavailable state rather than a reason to render a different provider.
 */
export function isBasemapStyleSupported(
  style: BasemapStyle,
  config: BasemapProviderConfig = buildProviderConfig(),
): boolean {
  return resolveBasemapAvailability(style, config).state === 'ready'
}

/**
 * Narrow a stored style to one this build understands.
 *
 * A saved `satellite` keeps its identity even when the build cannot render it,
 * so the caller can report it unavailable instead of silently showing street.
 */
export function normalizeBasemapStyle(style: string | null | undefined): BasemapStyle {
  return coerceBasemapStyle(style)
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
  readonly available: boolean
  /** Why the style cannot render; `null` when it can. */
  readonly unavailableReason: string | null
  /** A non-blocking caveat to show with the layer, e.g. the Google key prompt. */
  readonly notice: string | null
  readonly source: {
    readonly type: 'raster'
    readonly tiles: string[]
    readonly tileSize: number
    readonly attribution: string
    readonly maxzoom: number
  }
  readonly layer: {
    readonly id: typeof MAPLIBRE_BASEMAP_RASTER_LAYER_ID
    readonly type: 'raster'
    readonly source: typeof MAPLIBRE_BASEMAP_SOURCE_ID
    readonly minzoom: 0
  }
}

/**
 * The remote basemap contribution for one style.
 *
 * An unavailable style yields an empty tile list rather than another provider's
 * tiles, so no caller can accidentally render the wrong imagery. `tileSize` and
 * `maxzoom` come from the provider descriptor instead of a fixed 256/19
 * assumption, which is what lets Google's deeper zoom levels work.
 */
export function createMapLibreBasemapContribution(
  preferredStyle: BasemapStyle,
  googleMapsApiKey?: string | null,
): MapLibreBasemapContribution {
  const resolved = resolveBasemapAvailability(
    preferredStyle,
    buildProviderConfig(googleMapsApiKey),
  )
  const descriptor: BasemapDescriptor | null =
    resolved.state === 'ready' ? resolved.descriptor : null

  return {
    sourceId: MAPLIBRE_BASEMAP_SOURCE_ID,
    available: descriptor !== null,
    unavailableReason: resolved.state === 'unavailable' ? resolved.reason : null,
    notice: descriptor?.notice ?? null,
    source: {
      type: 'raster',
      tiles: descriptor ? [...descriptor.tiles] : [],
      tileSize: descriptor?.tileSize ?? 256,
      attribution: descriptor?.attribution ?? '',
      maxzoom: descriptor?.maxzoom ?? MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM,
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
  googleMapsApiKey?: string | null,
): MapLibreStyleDefinition {
  const emptyStyle = createMapLibreEmptyStyle()
  const contribution = createMapLibreBasemapContribution(preferredStyle, googleMapsApiKey)

  // An unavailable provider contributes no source and no raster layer at all,
  // leaving the local background visible instead of a broken or empty raster.
  if (!contribution.available) {
    return emptyStyle
  }

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
