// canvas/runtime/scene-extent.ts
//
// Owns a scene's extent for the view's fits (SceneBoundsOptions.extentPoints, spec §1.1): the corner points of every plant, zone
// and note footprint at a candidate scale, in plane metres. Notes and default-mode plants are screen-sized, so the extent depends
// on the scale. It sits outside view/ because it measures the scene (P4): the command and document surfaces pass it to the fits,
// and the legacy camera facade falls back to it when a caller passes no extent.

import { getAnnotationWorldBounds } from './annotation-layout'
import { getPlantWorldBounds, type PlantPresentationContext } from './plant-presentation'
import type { ScenePersistedState } from './scene'
import type { WorldPoint } from './view/types'
import { getZoneWorldBounds } from './zone-geometry'

interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * `plantContext` sizes the plants as the renderer does (species symbols, canopy spreads); without it, plants use a fresh species
 * cache at each scale. The context's own viewport is replaced by the candidate scale.
 */
export function sceneExtentPoints(
  scene: ScenePersistedState,
  plantContext?: PlantPresentationContext,
): (pixelsPerMetre: number) => readonly WorldPoint[] {
  return (pixelsPerMetre) => {
    const points: WorldPoint[] = []
    const corners = (box: Box): void => {
      points.push(
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
        { x: box.x, y: box.y + box.height },
      )
    }
    const plantsAtScale: PlantPresentationContext = {
      ...(plantContext ?? { speciesCache: new Map() }),
      viewport: { x: 0, y: 0, scale: pixelsPerMetre },
      plants: scene.plants,
    }
    for (const plant of scene.plants) corners(getPlantWorldBounds(plant, plantsAtScale))
    for (const zone of scene.zones) {
      const box = getZoneWorldBounds(zone)
      if (box) corners(box)
    }
    for (const annotation of scene.annotations) corners(getAnnotationWorldBounds(annotation, pixelsPerMetre))
    return points
  }
}
