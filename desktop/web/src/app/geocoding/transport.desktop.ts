import { geocodeAddress } from '../../ipc/geocoding'
import { NOMINATIM_PUBLIC_HOST, type GeocodingTransport } from './registry'
import { geocodingTransport as browserTransport } from './transport.browser'

/**
 * Desktop: Nominatim requests go through the native transport, which sends an
 * identifying User-Agent as Nominatim's usage policy requires (a webview
 * `fetch` cannot set one). Other providers use the webview's `fetch`.
 */
export const geocodingTransport: GeocodingTransport = async (url, signal) => {
  const parsed = new URL(url)
  if (parsed.hostname !== NOMINATIM_PUBLIC_HOST) return browserTransport(url, signal)
  const query = parsed.searchParams.get('q') ?? ''
  const results = await geocodeAddress(query)
  if (signal?.aborted) throw new DOMException('Geocoding was cancelled.', 'AbortError')
  return results.map((result) => ({
    lat: String(result.lat),
    lon: String(result.lon),
    display_name: result.display_name,
  }))
}
