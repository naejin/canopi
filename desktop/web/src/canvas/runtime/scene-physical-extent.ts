import type { ScenePersistedState } from './scene'
import { getZoneRadialExtentMeters } from './zone-geometry'

export function computeScenePhysicalExtentMeters(
  scene: ScenePersistedState,
): number | null {
  let maxDistanceMeters = 0
  let hasGeometry = false

  const includeDistance = (distanceMeters: number): void => {
    hasGeometry = true
    maxDistanceMeters = Math.max(maxDistanceMeters, distanceMeters)
  }
  const includePoint = (x: number, y: number): void => {
    includeDistance(Math.hypot(x, y))
  }

  for (const plant of scene.plants) includePoint(plant.position.x, plant.position.y)
  for (const zone of scene.zones) {
    const zoneExtent = getZoneRadialExtentMeters(zone)
    if (zoneExtent !== null) includeDistance(zoneExtent)
  }
  for (const annotation of scene.annotations) {
    includePoint(annotation.position.x, annotation.position.y)
  }
  for (const guide of scene.measurementGuides) {
    includePoint(guide.start.x, guide.start.y)
    includePoint(guide.end.x, guide.end.y)
  }

  return hasGeometry ? maxDistanceMeters : null
}
