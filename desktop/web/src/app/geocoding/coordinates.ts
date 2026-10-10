// app/geocoding/coordinates.ts
//
// Writes a WGS84 position for people: "48.851230° N, 2.352110° E", with the locale's digits, separator and hemisphere
// letters through Intl (canopi-f47t.42, Q21). It sits beside `parseCoordinates` (place-search.ts) because place search and
// the Site data pin share it, each at its own precision: 4 decimals for a place, 6 for a pin.

import { t } from '../../i18n'

const formatters = new Map<string, Intl.NumberFormat>()

function degrees(value: number, decimals: number, locale: string): string {
  const key = `${locale}:${decimals}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false })
    formatters.set(key, formatter)
  }
  return formatter.format(Math.abs(value))
}

export function formatCoordinates(lat: number, lon: number, decimals: number, locale: string): string {
  return t('canvas.placeSearch.coordinates', {
    lat: degrees(lat, decimals, locale),
    lon: degrees(lon, decimals, locale),
    northSouth: t(lat < 0 ? 'canvas.placeSearch.south' : 'canvas.placeSearch.north'),
    eastWest: t(lon < 0 ? 'canvas.placeSearch.west' : 'canvas.placeSearch.east'),
  })
}
