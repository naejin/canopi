/**
 * Resolve persisted north-bearing metadata without collapsing an explicit
 * `null` (no authored bearing) into the legacy fallback.
 */
export function resolvePersistedNorthBearingDeg(
  metadataBearing: number | null | undefined,
  documentBearing: number | null | undefined,
): number | null {
  if (metadataBearing !== undefined) return metadataBearing
  if (documentBearing !== undefined) return documentBearing
  return 0
}
