// canvas/runtime/tools/snapping.ts  (pure)
//
// Owns the ToolHost's grid and guide snapping (INV-TOOL-05): the grid first, then the ruler guides, both on world axes (user),
// at the frame's pixelsPerMetre, which is exact at bearing 0 where metresPerPixelAt is not (INV-XF-21). The host feeds
// ToolPoint.free, ToolPoint.snapped and ToolContext.snap from here. canvas/grid.ts and canvas/guides.ts keep the arithmetic,
// which the scene chrome and the rulers read too.

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
