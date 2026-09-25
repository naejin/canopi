import { createSessionPlane, type GeoPosition } from '../../canvas/session-plane'
import { hydrateSceneFromDesign } from '../../canvas/runtime/scene'
import type { CanopiFile } from '../../types/design'

/** Test-only authoring origin; production never converts metre fixtures. */
export const TEST_GEO_ORIGIN: GeoPosition = Object.freeze({ lon: 13, lat: 23 })

/**
 * Authors a v7 position from local metres (x east, y south) around `origin`.
 * Use it to write fixtures that read like the old metre ones.
 */
export function geoAt(x: number, y: number, origin: GeoPosition = TEST_GEO_ORIGIN): { lon: number; lat: number } {
  const geo = createSessionPlane(origin).toGeo({ x, y })
  return { lon: geo.lon, lat: geo.lat }
}

/**
 * The plane metres the runtime hydrates for a Design. The runtime centres its
 * session plane on the objects' bounds, so compare against this instead of the
 * metres a fixture was authored in.
 */
export function hydratedScene(file: CanopiFile) {
  return hydrateSceneFromDesign(file).persisted
}
