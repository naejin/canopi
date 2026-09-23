import type { BasemapStyle } from '../generated/contracts'

/**
 * The basemap provider boundary, shared by Desktop and Web.
 *
 * One module decides which remote source a basemap style maps to, what
 * attribution it requires, and whether it is available at all. It is pure with
 * respect to a supplied configuration so both editions and the tests agree, and
 * so no surface invents its own fallback. The three deployment facts it depends
 * on — the build-time MapTiler key, the device-local Google key and the locale —
 * are passed in rather than read here, which keeps the decision testable.
 *
 * Availability is deliberately distinct from *choice*:
 *
 * - `satellite` is MapTiler. Without its build key it is `unavailable`, never
 *   silently street or Google, so a saved MapTiler choice stays honest.
 * - `google_satellite` is always selectable. Without a device key it takes
 *   Google's keyless tile endpoint and carries a non-blocking prompt; with a key
 *   it takes the official Map Tiles API session path.
 */
export interface BasemapProviderConfig {
  /** Build-time MapTiler key, absent in builds without one. */
  readonly mapTilerKey?: string | undefined
  /** Device-local Google Maps API key. */
  readonly googleMapsApiKey?: string | null | undefined
  /** IETF-ish locale used for session requests and provider hints. */
  readonly locale?: string | undefined
}

export interface BasemapDescriptor {
  readonly style: BasemapStyle
  /** Stable provider identity, for labels and diagnostics. */
  readonly provider: 'openstreetmap' | 'maptiler' | 'google'
  /** Remote raster tiles in `{z}/{x}/{y}` form; empty when unavailable. */
  readonly tiles: readonly string[]
  readonly tileSize: number
  readonly maxzoom: number
  readonly attribution: string
  /** Google only: the official session path is in use. */
  readonly official: boolean
  /**
   * A non-blocking note the UI must show alongside the layer, e.g. the exact
   * Google key prompt. `null` when the provider needs no caveat.
   */
  readonly notice: string | null
}

export type BasemapAvailability =
  | { readonly state: 'ready'; readonly descriptor: BasemapDescriptor }
  | { readonly state: 'unavailable'; readonly style: BasemapStyle; readonly reason: string }

const OPENSTREETMAP_ATTRIBUTION = '&copy; OpenStreetMap contributors'
const MAPTILER_ATTRIBUTION = '&copy; MapTiler &copy; OpenStreetMap contributors'
/** Keyless Google tiles; not an authorized free service, see the product contract. */
const GOOGLE_KEYLESS_TILES = 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
const GOOGLE_KEYLESS_ATTRIBUTION = '&copy; Google'
/** The exact prompt the product contract fixes for the keyless path. */
export const GOOGLE_KEY_PROMPT = 'Enter a Google Maps API key to load the official Google tiles.'
/**
 * The official Map Tiles API 2D tile path.
 *
 * This is the published, **non-secret** template: it names the endpoint and
 * leaves the session unresolved. The live session token and the API key are
 * supplied per request by the map's tile transport, because the token is
 * per-generation and expires, and because a descriptor carrying a credential
 * could be persisted, exported or logged.
 */
export const GOOGLE_SESSION_TILES =
  'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}'

export const MAPTILER_SATELLITE_TILESET_ID = 'satellite-v4'
export const OPENSTREETMAP_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
/** The zoom ceiling the OSM and MapTiler descriptors already used. */
const STREET_MAX_ZOOM = 19
/** Google's 2D tiles address deeper zoom levels than the other providers. */
const GOOGLE_MAX_ZOOM = 22

function trimmedKey(value: string | null | undefined): string | null {
  const key = value?.trim()
  return key ? key : null
}

/**
 * Resolve one style to its provider availability.
 *
 * Every branch is explicit: there is no fall-through that quietly substitutes a
 * different provider for the one the user selected.
 */
export function resolveBasemapAvailability(
  style: BasemapStyle,
  config: BasemapProviderConfig = {},
): BasemapAvailability {
  if (style === 'satellite') {
    const key = trimmedKey(config.mapTilerKey)
    if (!key) {
      // The saved choice is kept and reported unavailable. Falling back to
      // street or Google here is exactly the silent substitution the contract
      // forbids, because it would relabel satellite imagery as something else.
      return {
        state: 'unavailable',
        style,
        reason: 'This build has no MapTiler key, so the saved satellite basemap cannot load.',
      }
    }
    return {
      state: 'ready',
      descriptor: {
        style,
        provider: 'maptiler',
        tiles: [
          `https://api.maptiler.com/tiles/${MAPTILER_SATELLITE_TILESET_ID}/{z}/{x}/{y}?key=${key}`,
        ],
        tileSize: 256,
        maxzoom: STREET_MAX_ZOOM,
        attribution: MAPTILER_ATTRIBUTION,
        official: false,
        notice: null,
      },
    }
  }

  if (style === 'google_satellite') {
    const key = trimmedKey(config.googleMapsApiKey)
    if (key) {
      // The published template is credential-free: the session owner acquires a
      // token per generation and the map's tile transport adds the live session
      // and key to requests for this fixed endpoint. Putting either in the
      // descriptor would let an ephemeral credential reach persistence, exports,
      // diagnostics or logs.
      return {
        state: 'ready',
        descriptor: {
          style,
          provider: 'google',
          tiles: [GOOGLE_SESSION_TILES],
          tileSize: 256,
          maxzoom: GOOGLE_MAX_ZOOM,
          // Copyright/availability metadata is required before official tiles
          // are shown; the session owner supplies the authoritative viewport
          // string and zoom availability. This is the minimum until then.
          attribution: GOOGLE_KEYLESS_ATTRIBUTION,
          official: true,
          notice: null,
        },
      }
    }
    // Keyless is a legitimate selectable path, not a degraded one, and the
    // prompt is required by the product decision.
    return {
      state: 'ready',
      descriptor: {
        style,
        provider: 'google',
        tiles: [GOOGLE_KEYLESS_TILES],
        tileSize: 256,
        maxzoom: GOOGLE_MAX_ZOOM,
        attribution: GOOGLE_KEYLESS_ATTRIBUTION,
        official: false,
        notice: GOOGLE_KEY_PROMPT,
      },
    }
  }

  return {
    state: 'ready',
    descriptor: {
      style: 'street',
      provider: 'openstreetmap',
      tiles: [OPENSTREETMAP_TILES],
      tileSize: 256,
      maxzoom: STREET_MAX_ZOOM,
      attribution: OPENSTREETMAP_ATTRIBUTION,
      official: false,
      notice: null,
    },
  }
}

/**
 * Whether a style can render at all with this configuration.
 *
 * Unknown strings resolve to street, matching the settings projection's own
 * behaviour, so a corrupt or future value cannot leave the map blank.
 */
export function isBasemapStyleRenderable(
  style: string | null | undefined,
  config: BasemapProviderConfig = {},
): boolean {
  return resolveBasemapAvailability(coerceBasemapStyle(style), config).state === 'ready'
}

/** Narrow an arbitrary stored string to a style this build understands. */
export function coerceBasemapStyle(style: string | null | undefined): BasemapStyle {
  if (style === 'satellite' || style === 'google_satellite') return style
  return 'street'
}
