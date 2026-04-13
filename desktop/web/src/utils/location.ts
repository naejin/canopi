export function formatLocationSummary(location: { lat: number; lon: number; altitude_m: number | null }): string {
  const base = `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`
  return location.altitude_m != null ? `${base} (${location.altitude_m} m)` : base
}
