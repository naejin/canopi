// canvas/runtime/tools/stamp-ghost.ts  (pure)
//
// Owns how the Object and saved stamps show what a press would place: drafts of 'objects' ghosts, zones and plants in one
// at 0.62 and notes in a second at 0.68 (today's opacities). Both stamp tools build their ghosts here, and so does the
// saved stamp's dragover preview for the drop route (tools/saved-object-stamp.ts).

import type { SceneArrangementTemplate } from '../scene-runtime/arrangement-placement'
import type { WorldPoint } from '../view/types'
import type { DraftShape } from './draft'
import type { StampEntities } from './stamp-rotation'

const STAMP_GHOST_OPACITY = 0.62
/** Notes draw a little less faint than zones and plants (the draft layer multiplies each note's own opacities). */
const STAMP_GHOST_NOTE_OPACITY = 0.68

/**
 * A stamp's ghosts as drafts: zones and plants in one 'objects' ghost at 0.62, notes in a second at 0.68 (today's
 * opacities). The entities are already where a press would put them; `anchor` and `rotationDeg` describe the pick.
 */
export function stampGhostShapes(entities: StampEntities, anchor: WorldPoint, rotationDeg: number): DraftShape[] {
  const shapes: DraftShape[] = []
  if (entities.plants.length + entities.zones.length > 0) {
    shapes.push(ghostOf({ ...entities, annotations: [] }, anchor, rotationDeg, STAMP_GHOST_OPACITY))
  }
  if (entities.annotations.length > 0) {
    shapes.push(ghostOf({ plants: [], zones: [], annotations: entities.annotations }, anchor, rotationDeg, STAMP_GHOST_NOTE_OPACITY))
  }
  return shapes
}

function ghostOf(entities: StampEntities, anchor: WorldPoint, rotationDeg: number, opacity: number): DraftShape {
  const template: SceneArrangementTemplate = {
    plants: entities.plants.map((entity) => ({ sourceId: entity.id, entity })),
    zones: entities.zones.map((entity) => ({ sourceId: entity.id, entity })),
    annotations: entities.annotations.map((entity) => ({ sourceId: entity.id, entity })),
    measurementGuides: [],
    groups: [],
  }
  return { kind: 'ghost', opacity, entity: { kind: 'objects', anchor, rotationDeg, template } }
}
