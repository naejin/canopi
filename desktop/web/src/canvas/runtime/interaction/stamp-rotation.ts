import type { SceneArrangementTemplate } from '../scene-runtime/arrangement-placement'
import {
  rotateAnnotationAbout,
  rotatePlantAbout,
  rotateZoneAbout,
} from '../scene-runtime/selection-rotation'
import type { SceneAnnotationEntity, ScenePlantEntity, ScenePoint, SceneZoneEntity } from '../scene'
import { isEditableTarget } from './pointer-utils'

/** `[` and `]` turn a held stamp by this much; positive is clockwise on the map. */
export const STAMP_ROTATION_STEP_DEG = 15

export interface StampRotationKeys {
  /** The map host: with single-key shortcuts off, the keys work only while it has focus. */
  readonly container: HTMLElement
  /** Settings › Keyboard › Single-key shortcuts. */
  readonly readSingleKeyShortcuts: () => boolean
}

/**
 * The turn `[` (anticlockwise) or `]` (clockwise) asks for, or null. Like other
 * single-key shortcuts they never act in a text field or with Ctrl, Cmd or Alt;
 * with single-key shortcuts off they still work while the map has focus, as
 * the arrow keys do.
 */
export function stampRotationStep(event: KeyboardEvent, keys: StampRotationKeys): number | null {
  if (event.key !== '[' && event.key !== ']') return null
  if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return null
  const onMap = event.target instanceof Node && keys.container.contains(event.target)
  if (!onMap && !keys.readSingleKeyShortcuts()) return null
  return event.key === ']' ? STAMP_ROTATION_STEP_DEG : -STAMP_ROTATION_STEP_DEG
}

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
