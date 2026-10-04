/**
 * The Satellite row's imagery boundary, shared by Desktop and Web.
 *
 * Google is the only satellite imagery. Pure with respect to its
 * configuration, so both editions and the tests agree and no surface invents
 * its own fallback:
 *
 * - Without a device key it serves Google's public `mt1.google.com` tiles
 *   keylessly, as GeoLibre's basemap control does. That endpoint is not a
 *   published API and Google's terms do not cover using it directly; the user
 *   chose it for its resolution (ADR 0001).
 * - With the user's device key it switches to the official Map Tiles API
 *   session tiles.
 */
export interface SatelliteConfig {
  /** Device-local Google Maps API key. */
  readonly googleMapsApiKey?: string | null | undefined
  /** IETF-ish locale used for Google session requests. */
  readonly locale?: string | undefined
}

export interface SatelliteDescriptor {
  /** Remote raster tiles in `{z}/{x}/{y}` form. */
  readonly tiles: readonly string[]
  readonly tileSize: number
  readonly maxzoom: number
  readonly attribution: string
  /** Official Map Tiles API: tiles need a live session through the map's tile transport. */
  readonly official: boolean
}

/**
 * The official Map Tiles API 2D tile path. This is the published,
 * **non-secret** template: the live session and the key are supplied per
 * request by the map's tile transport (`basemap-tile-auth.ts`), because a
 * descriptor carrying a credential could be persisted, exported or logged.
 */
export const GOOGLE_SESSION_TILES =
  'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}'
/** Google's public satellite tiles (`lyrs=s`), used while no device key is set. */
export const GOOGLE_KEYLESS_TILES = 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
const GOOGLE_ATTRIBUTION = '&copy; Google'
const GOOGLE_MAX_ZOOM = 22
const GOOGLE_KEYLESS_MAX_ZOOM = 20

/** Keyless public tiles without a key; official session tiles with one. */
export function resolveSatelliteDescriptor(
  config: SatelliteConfig = {},
): SatelliteDescriptor {
  if (!config.googleMapsApiKey?.trim()) {
    return {
      tiles: [GOOGLE_KEYLESS_TILES],
      tileSize: 256,
      maxzoom: GOOGLE_KEYLESS_MAX_ZOOM,
      attribution: GOOGLE_ATTRIBUTION,
      official: false,
    }
  }
  return {
    tiles: [GOOGLE_SESSION_TILES],
    tileSize: 256,
    maxzoom: GOOGLE_MAX_ZOOM,
    // The session owner replaces this with the viewport copyright string.
    attribution: GOOGLE_ATTRIBUTION,
    official: true,
  }
}
