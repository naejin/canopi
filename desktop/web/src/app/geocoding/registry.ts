/*
 * Geocoding provider registry adapted from GeoLibre
 * packages/core/src/geocoding.ts at commit e9df9e2 (forward geocoding only:
 * the provider interface, Nominatim and Pelias providers, URL building and
 * pacing). Copyright (c) 2026 Qiusheng Wu. MIT License; see THIRD_PARTY_NOTICES.md.
 */

export const DEFAULT_FORWARD_GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search'
/** Host whose public usage policy (1 request per second) must be respected. */
export const NOMINATIM_PUBLIC_HOST = 'nominatim.openstreetmap.org'
/** Nominatim's public policy is 1 request/second; 1.1 s leaves margin. */
export const NOMINATIM_MIN_INTERVAL_MS = 1100
export const NOMINATIM_ATTRIBUTION = 'Search by Nominatim · © OpenStreetMap contributors'

export type GeocodingProviderId = 'nominatim' | 'pelias'
export const DEFAULT_GEOCODING_PROVIDER_ID: GeocodingProviderId = 'nominatim'

export interface GeocoderConfig {
  readonly providerId: GeocodingProviderId
  readonly forwardEndpoint: string
  /** Contact email sent as the `email` query parameter to identify the client. */
  readonly email?: string
  readonly apiKey?: string
}

/** A normalized forward-geocoding match. */
export interface GeocodeMatch {
  readonly lat: number
  readonly lon: number
  readonly displayName: string
  /** The provider's own confidence scale, or null when it reports none. */
  readonly score: number | null
}

/** Pure request building and response normalizing; the transport does the fetch. */
export interface GeocodingProvider {
  readonly id: GeocodingProviderId
  readonly label: string
  /** Credit shown with results. */
  readonly attribution: string
  readonly defaultForwardEndpoint: string
  buildForwardUrl(config: GeocoderConfig, query: string, options: { limit?: number }): string
  parseForward(data: unknown): GeocodeMatch[]
}

/**
 * Performs one GET and returns the parsed JSON body (undefined for an empty
 * body). Web passes browser `fetch`; Desktop routes Nominatim through the
 * native transport, which sends an identifying User-Agent.
 */
export type GeocodingTransport = (url: string, signal: AbortSignal | undefined) => Promise<unknown>

interface NominatimForwardResult {
  readonly lat: string
  readonly lon: string
  readonly display_name?: string
  readonly importance?: number | string
}

function coerceScore(value: number | string | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function readString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const value = (obj as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
  }
  return undefined
}

/** Build a Nominatim forward-geocoding URL (jsonv2). */
export function buildForwardGeocodeUrl(
  endpoint: string,
  query: string,
  options: { email?: string; limit?: number } = {},
): string {
  const url = new URL(endpoint)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', String(options.limit ?? 1))
  if (options.email) url.searchParams.set('email', options.email)
  return url.toString()
}

function nominatimForwardResultToMatch(result: NominatimForwardResult): GeocodeMatch | null {
  const lat = Number(result.lat)
  const lon = Number(result.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon, displayName: result.display_name ?? '', score: coerceScore(result.importance) }
}

const nominatimProvider: GeocodingProvider = {
  id: 'nominatim',
  label: 'Nominatim (OpenStreetMap)',
  attribution: NOMINATIM_ATTRIBUTION,
  defaultForwardEndpoint: DEFAULT_FORWARD_GEOCODE_ENDPOINT,
  buildForwardUrl: (config, query, options) =>
    buildForwardGeocodeUrl(config.forwardEndpoint, query, {
      ...(config.email ? { email: config.email } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    }),
  parseForward: (data) =>
    Array.isArray(data)
      ? (data as NominatimForwardResult[])
          .map(nominatimForwardResultToMatch)
          .filter((match): match is GeocodeMatch => match !== null)
      : [],
}

function geojsonFeatures(data: unknown): Record<string, unknown>[] {
  if (data && typeof data === 'object' && Array.isArray((data as { features?: unknown }).features)) {
    return (data as { features: unknown[] }).features.filter(
      (feature): feature is Record<string, unknown> => !!feature && typeof feature === 'object',
    )
  }
  return []
}

function pointCoords(feature: Record<string, unknown>): [number, number] | null {
  const coords = (feature.geometry as { coordinates?: unknown } | undefined)?.coordinates
  if (Array.isArray(coords) && coords.length >= 2) {
    const lon = Number(coords[0])
    const lat = Number(coords[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat]
  }
  return null
}

/** A Pelias/Photon-style alternative, should Nominatim become unavailable. */
const peliasProvider: GeocodingProvider = {
  id: 'pelias',
  label: 'Pelias',
  attribution: 'Search by Pelias · © OpenStreetMap contributors',
  defaultForwardEndpoint: 'https://api.geocode.earth/v1/search',
  buildForwardUrl: (config, query, options) => {
    const url = new URL(config.forwardEndpoint)
    url.searchParams.set('text', query)
    if (options.limit) url.searchParams.set('size', String(options.limit))
    if (config.apiKey) url.searchParams.set('api_key', config.apiKey)
    return url.toString()
  },
  parseForward: (data) =>
    geojsonFeatures(data)
      .map((feature): GeocodeMatch | null => {
        const coords = pointCoords(feature)
        if (!coords) return null
        const props = (feature.properties as Record<string, unknown>) ?? {}
        return {
          lon: coords[0],
          lat: coords[1],
          displayName: readString(props, 'label') ?? '',
          score: coerceScore(props.confidence as number | undefined),
        }
      })
      .filter((match): match is GeocodeMatch => match !== null),
}

/** Selectable providers, Nominatim first (the default). */
export const GEOCODING_PROVIDERS: readonly GeocodingProvider[] = [nominatimProvider, peliasProvider]

export function getGeocodingProvider(id: GeocodingProviderId | null | undefined): GeocodingProvider {
  return GEOCODING_PROVIDERS.find((provider) => provider.id === id) ?? nominatimProvider
}

export function defaultGeocoderConfig(): GeocoderConfig {
  return { providerId: DEFAULT_GEOCODING_PROVIDER_ID, forwardEndpoint: DEFAULT_FORWARD_GEOCODE_ENDPOINT }
}

/** Whether requests to `endpoint` fall under Nominatim's public usage policy. */
export function shouldThrottle(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname === NOMINATIM_PUBLIC_HOST
  } catch {
    return true
  }
}

/** Minimum spacing between requests for `endpoint`. */
export function geocoderMinIntervalMs(endpoint: string): number {
  return shouldThrottle(endpoint) ? NOMINATIM_MIN_INTERVAL_MS : 0
}

/**
 * Milliseconds to wait before the next request so consecutive requests start
 * at least `intervalMs` apart, measured from the previous start.
 */
export function nextDelayMs(lastStartedAt: number | null, now: number, intervalMs: number): number {
  if (lastStartedAt === null) return 0
  return Math.max(0, intervalMs - (now - lastStartedAt))
}

/** Forward-geocode one query through the configured provider and transport. */
export async function geocodeForward(
  query: string,
  transport: GeocodingTransport,
  options: { signal?: AbortSignal; config?: GeocoderConfig; limit?: number } = {},
): Promise<GeocodeMatch[]> {
  const config = options.config ?? defaultGeocoderConfig()
  const provider = getGeocodingProvider(config.providerId)
  const url = provider.buildForwardUrl(config, query, { ...(options.limit ? { limit: options.limit } : {}) })
  return provider.parseForward(await transport(url, options.signal))
}
