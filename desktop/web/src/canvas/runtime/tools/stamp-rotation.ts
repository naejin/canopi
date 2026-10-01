// canvas/runtime/tools/stamp-rotation.ts  (pure)
//
// Owns the held angle of the Object and saved stamps, how a stamp's objects turn about its anchor, and the ghosts that
// show what a press would place: drafts of 'objects' ghosts, zones and plants in one at 0.62 and notes in a second at
// 0.68 (today's opacities), for both stamp tools and the saved stamp's dragover preview for the drop route. `[` and `]`
// reach the stamp tools as rotate-held commands of ±15° from the keyboard port, which keeps today's key gating (spec
// §1.2a).

import type { SceneArrangementTemplate } from '../scene-runtime/arrangement-placement'
import {
  rotateAnnotationAbout,
  rotatePlantAbout,
  rotateZoneAbout,
} from '../scene-runtime/selection-rotation'
import type { SceneAnnotationEntity, ScenePlantEntity, ScenePoint, SceneZoneEntity } from '../scene/types'
import type { WorldPoint } from '../view/types'
import type { DraftShape } from './draft'

const STAMP_GHOST_OPACITY = 0.62
/** Notes draw a little less faint than zones and plants (the draft layer multiplies each note's own opacities). */
const STAMP_GHOST_NOTE_OPACITY = 0.68

/** The stamp's angle after a step, kept in 0–345°. */
export function turnStampRotation(current: number, step: number): number {
  return (((current + step) % 360) + 360) % 360
}

export interface StampEntities {
  readonly plants: readonly ScenePlantEntity[]
  readonly zones: readonly SceneZoneEntity[]
  readonly annotations: readonly SceneAnnotationEntity[]
}

/** A stamp's objects turned about its anchor, as the selection rotation turns them. */
export function rotateStampEntities(entities: StampEntities, pivot: ScenePoint, degrees: number): StampEntities {
  if (degrees === 0) return entities
  return {
    plants: entities.plants.map((plant) => rotatePlantAbout(plant, pivot, degrees)),
    zones: entities.zones.map((zone) => rotateZoneAbout(zone, pivot, degrees)),
    annotations: entities.annotations.map((annotation) => rotateAnnotationAbout(annotation, pivot, degrees)),
  }
}

/** The placement template turned about the stamp's anchor, before it is moved under the pointer. */
export function rotateArrangementTemplate(
  template: SceneArrangementTemplate,
  pivot: ScenePoint,
  degrees: number,
): SceneArrangementTemplate {
  if (degrees === 0) return template
  return {
    ...template,
    plants: template.plants.map((entry) => ({ ...entry, entity: rotatePlantAbout(entry.entity, pivot, degrees) })),
    zones: template.zones.map((entry) => ({ ...entry, entity: rotateZoneAbout(entry.entity, pivot, degrees) })),
    annotations: template.annotations.map((entry) => ({ ...entry, entity: rotateAnnotationAbout(entry.entity, pivot, degrees) })),
  }
}

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
