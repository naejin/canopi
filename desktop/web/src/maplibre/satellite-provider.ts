import type { SatelliteProvider } from '../generated/contracts'

/**
 * The Satellite row's provider boundary, shared by Desktop and Web.
 *
 * Pure with respect to its configuration, so both editions and the tests agree
 * and no surface invents its own fallback:
 *
 * - `eox` is EOX Sentinel-2 cloudless 2017 (CC BY 4.0), keyless, about 10 m
 *   per pixel. Esri World Imagery was not adopted: its Master License Agreement
 *   does not clearly allow keyless display in a free third-party app.
 * - `google` is the official Map Tiles API and needs the user's device key.
 *   Without a key it is unavailable and the UI prompts for one; there is no
 *   keyless Google path.
 */
export interface SatelliteProviderConfig {
  /** Device-local Google Maps API key. */
  readonly googleMapsApiKey?: string | null | undefined
  /** IETF-ish locale used for Google session requests. */
  readonly locale?: string | undefined
}

export interface SatelliteDescriptor {
  readonly provider: SatelliteProvider
  /** Remote raster tiles in `{z}/{x}/{y}` form. */
  readonly tiles: readonly string[]
  readonly tileSize: number
  readonly maxzoom: number
  readonly attribution: string
  /** Google: tiles need a live session through the map's tile transport. */
  readonly official: boolean
}

export type SatelliteAvailability =
  | { readonly state: 'ready'; readonly descriptor: SatelliteDescriptor }
  | { readonly state: 'unavailable'; readonly provider: SatelliteProvider; readonly reason: string }

export const EOX_SATELLITE_TILES =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2017_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'
export const EOX_SATELLITE_ATTRIBUTION =
  '<a href="https://cloudless.eox.at" target="_blank">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2017), CC BY 4.0'
/** Sentinel-2 is ~10 m per pixel; deeper tiles are upsampled by the service. */
const EOX_MAX_ZOOM = 17
/**
 * The official Map Tiles API 2D tile path. This is the published,
 * **non-secret** template: the live session and the key are supplied per
 * request by the map's tile transport (`basemap-tile-auth.ts`), because a
 * descriptor carrying a credential could be persisted, exported or logged.
 */
export const GOOGLE_SESSION_TILES =
  'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}'
const GOOGLE_ATTRIBUTION = '&copy; Google'
const GOOGLE_MAX_ZOOM = 22
export const GOOGLE_KEY_REQUIRED_REASON = 'google-key-required'

export function resolveSatelliteAvailability(
  provider: SatelliteProvider,
  config: SatelliteProviderConfig = {},
): SatelliteAvailability {
  if (provider === 'google') {
    if (!config.googleMapsApiKey?.trim()) {
      return { state: 'unavailable', provider, reason: GOOGLE_KEY_REQUIRED_REASON }
    }
    return {
      state: 'ready',
      descriptor: {
        provider,
        tiles: [GOOGLE_SESSION_TILES],
        tileSize: 256,
        maxzoom: GOOGLE_MAX_ZOOM,
        // The session owner replaces this with the viewport copyright string.
        attribution: GOOGLE_ATTRIBUTION,
        official: true,
      },
    }
  }
  return {
    state: 'ready',
    descriptor: {
      provider: 'eox',
      tiles: [EOX_SATELLITE_TILES],
      tileSize: 256,
      maxzoom: EOX_MAX_ZOOM,
      attribution: EOX_SATELLITE_ATTRIBUTION,
      official: false,
    },
  }
}
