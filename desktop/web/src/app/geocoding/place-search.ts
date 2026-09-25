import { signal, type ReadonlySignal } from '@preact/signals'
import { WEB_MERCATOR_MAX_LATITUDE_DEG } from '../../generated/canopi-design-format'
import {
  defaultGeocoderConfig,
  geocodeForward,
  geocoderMinIntervalMs,
  getGeocodingProvider,
  nextDelayMs,
  type GeocoderConfig,
  type GeocodingTransport,
} from './registry'

export interface PlaceSearchResult {
  readonly label: string
  readonly lat: number
  readonly lon: number
  readonly source: 'coordinates' | 'geocoder'
}

export type PlaceSearchStatus = 'idle' | 'searching' | 'results' | 'no-results' | 'error'

export interface PlaceSearchController {
  readonly results: ReadonlySignal<readonly PlaceSearchResult[]>
  readonly status: ReadonlySignal<PlaceSearchStatus>
  /** Credit to show with geocoder results; null for coordinates. */
  readonly attribution: ReadonlySignal<string | null>
  /** Runs one search; called on Enter only, never while typing. */
  search(query: string): Promise<void>
  clear(): void
  dispose(): void
}

export interface PlaceSearchOptions {
  readonly transport: GeocodingTransport
  readonly config?: GeocoderConfig
  readonly limit?: number
  readonly now?: () => number
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

const COORDINATE_PATTERN = /^\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i

/**
 * Parses "lat, lon" (also "lat lon", "48.85N 2.35E") locally, so coordinates
 * never cost a network request. Latitude must be within the Web Mercator range.
 */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const match = COORDINATE_PATTERN.exec(text)
  if (!match) return null
  let lat = Number(match[1])
  let lon = Number(match[3])
  if (match[2]?.toUpperCase() === 'S') lat = -Math.abs(lat)
  if (match[4]?.toUpperCase() === 'W') lon = -Math.abs(lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > WEB_MERCATOR_MAX_LATITUDE_DEG || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/** Start time of the last geocoder request per endpoint, shared app-wide. */
const lastRequestStartedAt = new Map<string, number>()

export function resetPlaceSearchPacingForTests(): void {
  lastRequestStartedAt.clear()
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Search was superseded.', 'AbortError'))
    }, { once: true })
  })
}

export function createPlaceSearchController(options: PlaceSearchOptions): PlaceSearchController {
  const results = signal<readonly PlaceSearchResult[]>([])
  const status = signal<PlaceSearchStatus>('idle')
  const attribution = signal<string | null>(null)
  const config = options.config ?? defaultGeocoderConfig()
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? abortableSleep
  let controller: AbortController | null = null

  const cancel = () => {
    controller?.abort()
    controller = null
  }

  return {
    results,
    status,
    attribution,
    async search(query) {
      cancel()
      const trimmed = query.trim()
      if (!trimmed) {
        results.value = []
        status.value = 'idle'
        attribution.value = null
        return
      }
      const coordinates = parseCoordinates(trimmed)
      if (coordinates) {
        results.value = [{
          label: `${coordinates.lat.toFixed(6)}, ${coordinates.lon.toFixed(6)}`,
          ...coordinates,
          source: 'coordinates',
        }]
        status.value = 'results'
        attribution.value = null
        return
      }
      const current = new AbortController()
      controller = current
      status.value = 'searching'
      try {
        const endpoint = config.forwardEndpoint
        const interval = geocoderMinIntervalMs(endpoint)
        await sleep(nextDelayMs(lastRequestStartedAt.get(endpoint) ?? null, now(), interval), current.signal)
        if (current.signal.aborted) return
        lastRequestStartedAt.set(endpoint, now())
        const matches = await geocodeForward(trimmed, options.transport, {
          signal: current.signal,
          config,
          limit: options.limit ?? 5,
        })
        if (controller !== current) return
        // Nominatim can return several OSM objects (a town and its boundary)
        // under one name; the user can only tell them apart by label.
        const seen = new Set<string>()
        results.value = matches
          .filter((match) => !seen.has(match.displayName) && seen.add(match.displayName))
          .map((match) => ({
            label: match.displayName,
            lat: match.lat,
            lon: match.lon,
            source: 'geocoder',
          }))
        status.value = results.value.length > 0 ? 'results' : 'no-results'
        attribution.value = getGeocodingProvider(config.providerId).attribution
      } catch (error) {
        if (controller !== current || (error instanceof DOMException && error.name === 'AbortError')) return
        results.value = []
        status.value = 'error'
        attribution.value = null
      } finally {
        if (controller === current) controller = null
      }
    },
    clear() {
      cancel()
      results.value = []
      status.value = 'idle'
      attribution.value = null
    },
    dispose: cancel,
  }
}
