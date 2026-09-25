import type { GeocodingTransport } from './registry'

/** Web: browser `fetch`; the browser sends the page Referer that identifies the app. */
export const geocodingTransport: GeocodingTransport = async (url, signal) => {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) })
  if (!response.ok) throw new Error(`Geocoder returned HTTP ${response.status}`)
  const text = await response.text()
  return text.trim() ? JSON.parse(text) as unknown : undefined
}
