// canvas/runtime/tools/snapping.ts  (pure)
//
// Owns the ToolHost's grid and guide snapping: the grid first, then the ruler guides, both on true east and north (world
// axes, user), whatever the bearing: on a turned map the lattice turns with the map (spec §4.6). The interval comes from
// the frame's pixelsPerMetre (the plane origin's scale, which the bearing does not change). The host feeds
// ToolPoint.free, ToolPoint.snapped and ToolContext.snap from here. canvas/grid.ts and canvas/guides.ts keep the
// arithmetic, which the drawn grid and the rulers read too, so the grid lines are the snap lattice.

import { gridInterval, snapToGrid } from '../../grid'
import { snapToGuides, type Guide } from '../../guides'
import type { WorldPoint } from '../view/types'

/** Which snapping the settings turn on (Settings › Canvas: snap to grid, snap to guides). */
export interface SnapSettings {
  readonly grid: boolean
  readonly guides: boolean
}

/** `point` snapped to the grid, then to the guides; the point itself when neither applies. */
export function snapWorldPoint(
  point: WorldPoint,
  settings: SnapSettings,
  pixelsPerMetre: number,
  guides: readonly Guide[],
): WorldPoint {
  let next = point
  if (settings.grid) {
    next = snapToGrid(next.x, next.y, gridInterval(pixelsPerMetre).interval)
  }
  if (settings.guides && guides.length > 0) {
    next = snapToGuides(next.x, next.y, pixelsPerMetre, guides)
  }
  return next
}
