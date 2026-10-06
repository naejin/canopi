// canvas/runtime/tools/snapping.ts  (pure)
//
// Owns the ToolHost's grid snapping, on true east and north (world axes, user), whatever the bearing: on a turned map
// the lattice turns with the map (spec §4.6). The interval comes from the frame's pixelsPerMetre (the plane origin's
// scale, which the bearing does not change). The host feeds ToolPoint.free, ToolPoint.snapped and ToolContext.snap from
// here. canvas/grid.ts keeps the arithmetic, which the drawn grid reads too, so the grid lines are the snap lattice.

import { gridInterval, snapToGrid } from '../../grid'
import type { WorldPoint } from '../view/types'

/** Which snapping the settings turn on (Snap to grid). */
export interface SnapSettings {
  readonly grid: boolean
}

/** `point` snapped to the grid; the point itself when snapping is off. */
export function snapWorldPoint(point: WorldPoint, settings: SnapSettings, pixelsPerMetre: number): WorldPoint {
  if (!settings.grid) return point
  return snapToGrid(point.x, point.y, gridInterval(pixelsPerMetre).interval)
}
