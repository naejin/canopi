/**
 * Resolve persisted north-bearing metadata without collapsing an explicit or
 * absent bearing (no authored bearing) into a runtime projection fallback.
 */
export function resolvePersistedNorthBearingDeg(
  metadataBearing: number | null | undefined,
  documentBearing: number | null | undefined,
): number | null {
  if (metadataBearing !== undefined) return metadataBearing
  return documentBearing ?? null
}
