// canvas/runtime/tools/select/click.ts
//
// Owns what a Select press does to the selection, at the press, and what its click does at the release, with the
// history-free selection effect: a hit on a directly locked object selects it (toggles it when additive, removes it on
// Alt) and moves nothing; a double-click on a plant (the platform's click count) selects the plant's species; a double-click on a note (the platform's, or two presses within 500 ms on the host's clock and 6 px
// on the same note after a click that did not move) opens the note for editing; an additive press toggles the hit; any
// other hit is selected unless it already is and starts a move-drag, and an Alt click on it (subtractive) removes it from
// the selection the press found; empty ground (or a hit locked through its group or layer) clears the selection unless
// additive and starts the band. A press inside a zone's fill with nothing else under it (HitFilter.fill) is empty ground
// that remembers the zone: its click selects the zone (toggles it when additive, removes it on Alt, which leaves the
// selection as it was at the press), and its drag bands. Additive is Shift, Ctrl or Cmd (ToolModifiers.additive),
// subtractive is Alt without them.

import {
  applySpeciesSelection,
  getSelectablePlantIdsForSpecies,
} from '../../scene-runtime/species-selection'
import {
  normalizeSceneDesignObjectTargets,
  sceneTargetKey,
  type SceneDesignObjectSelection,
  type SceneDesignObjectTarget,
} from '../../scene/design-object-targets'
import { isDirectSceneDesignObjectLocked, isSceneDesignObjectLocked } from '../../scene/locks'
import type { WorldPoint } from '../../view/types'
import type { HitTarget, ToolContext, ToolPoint } from '../tool'

/** Select's own note double-click, beside the platform's click count. */
const DOUBLE_CLICK_INTERVAL_MS = 500
const DOUBLE_CLICK_DISTANCE_PX = 6

/** What the press goes on to do. */
export type SelectPress =
  /** `fill`: the zone (or its group) whose fill the press was in, which the click selects. */
  | { readonly kind: 'band'; readonly additive: boolean; readonly subtractive: boolean; readonly fill: SceneDesignObjectTarget | null }
  /** `removeFrom`: an Alt press's selection before it; its click removes the target from it. */
  | { readonly kind: 'move'; readonly target: SceneDesignObjectTarget; readonly removeFrom: SceneDesignObjectSelection | null }
  | { readonly kind: 'edit-note'; readonly annotationId: string }
  | { readonly kind: 'done' }

/** A click that did not move, which a second press on the same note within the interval turns into a double-click. */
export interface ClickCandidate {
  readonly target: SceneDesignObjectTarget
  readonly world: WorldPoint
  readonly atMs: number
}

/** What selecting needs of the tool's context: Select's, or the host's overview selector's. */
export type SelectionContext = Pick<ToolContext, 'scene' | 'view'> & { readonly effects: Pick<ToolContext['effects'], 'setSelection'> }

/**
 * Selects for the press and says what follows. `lastClick` is the previous click that did not move. `filter` is the hit
 * filter of the press's fill query (overview's hides plants).
 */
export function pressSelection(
  ctx: SelectionContext,
  point: ToolPoint,
  rawHit: HitTarget | null,
  clickCount: number,
  lastClick: ClickCandidate | null,
  nowMs: number,
  filter: { readonly overview?: true } = {},
): SelectPress {
  const scene = ctx.scene.persisted
  const target = rawHit?.kind === 'object' ? rawHit.target : null
  const lockedHit = target && isDirectSceneDesignObjectLocked(scene, target) ? target : null
  const hit = target && (!isSceneDesignObjectLocked(scene, target) || lockedHit) ? target : null
  const additive = point.modifiers.additive
  const subtractive = point.modifiers.subtractive && !additive

  if (!hit) {
    const fill = rawHit ? null : selectableFill(ctx, point.world, filter)
    if (!additive && !(subtractive && fill)) ctx.effects.setSelection([])
    return { kind: 'band', additive, subtractive, fill }
  }

  if (lockedHit) {
    ctx.effects.setSelection(clickedSelection(ctx.scene.selection(), lockedHit, additive, subtractive))
    return { kind: 'done' }
  }

  if (clickCount >= 2 && hit.kind === 'plant') {
    const plant = scene.plants.find((entry) => entry.id === hit.id)
    if (!plant) return { kind: 'done' }
    const speciesPlantIds = getSelectablePlantIdsForSpecies(scene, plant.canonicalName)
    if (speciesPlantIds.length === 0) return { kind: 'done' }
    ctx.effects.setSelection(applySpeciesSelection(ctx.scene.selection(), speciesPlantIds, additive))
    return { kind: 'done' }
  }

  if (
    !additive
    && !subtractive
    && hit.kind === 'annotation'
    && (clickCount >= 2 || isNoteDoubleClick(ctx, lastClick, hit, point.world, nowMs))
  ) {
    ctx.effects.setSelection([hit])
    return { kind: 'edit-note', annotationId: hit.id }
  }

  const selection = ctx.scene.selection()
  if (additive) {
    ctx.effects.setSelection(toggleSelectionTarget(selection, hit))
    return { kind: 'done' }
  }
  if (!selection.some((candidate) => sceneTargetKey(candidate) === sceneTargetKey(hit))) {
    ctx.effects.setSelection([hit])
  }
  return { kind: 'move', target: hit, removeFrom: subtractive ? selection : null }
}

/** The click of a press that did not move: a fill press selects its zone, an Alt press removes its target. */
export function clickSelection(ctx: SelectionContext, press: SelectPress): void {
  if (press.kind === 'band' && press.fill) {
    ctx.effects.setSelection(clickedSelection(ctx.scene.selection(), press.fill, press.additive, press.subtractive))
  } else if (press.kind === 'move' && press.removeFrom) {
    ctx.effects.setSelection(clickedSelection(press.removeFrom, press.target, false, true))
  }
}

/** The zone (or its group) whose fill holds `world`, unless it is locked through its group or layer. */
function selectableFill(ctx: SelectionContext, world: WorldPoint, filter: { readonly overview?: true }): SceneDesignObjectTarget | null {
  const hit = ctx.scene.hitAt(world, { ...filter, fill: true })
  const target = hit?.kind === 'object' ? hit.target : null
  if (!target) return null
  const scene = ctx.scene.persisted
  return !isSceneDesignObjectLocked(scene, target) || isDirectSceneDesignObjectLocked(scene, target) ? target : null
}

/** The selection after a click on `target`: toggled when additive, without it when subtractive, else it alone. */
function clickedSelection(
  selection: SceneDesignObjectSelection,
  target: SceneDesignObjectTarget,
  additive: boolean,
  subtractive: boolean,
): SceneDesignObjectTarget[] {
  if (additive) return toggleSelectionTarget(selection, target)
  if (subtractive) return selection.filter((candidate) => sceneTargetKey(candidate) !== sceneTargetKey(target))
  return [target]
}

/** Select's own double-click on a note: the same note, within 500 ms and 6 px of the last click that did not move. */
function isNoteDoubleClick(
  ctx: SelectionContext,
  previous: ClickCandidate | null,
  target: SceneDesignObjectTarget,
  world: WorldPoint,
  nowMs: number,
): boolean {
  if (!previous) return false
  if (previous.target.kind !== target.kind || previous.target.id !== target.id) return false
  if (nowMs - previous.atMs > DOUBLE_CLICK_INTERVAL_MS) return false
  return ctx.view.screenDistance(previous.world, world) <= DOUBLE_CLICK_DISTANCE_PX
}

function toggleSelectionTarget(
  selection: SceneDesignObjectSelection,
  target: SceneDesignObjectTarget,
): SceneDesignObjectTarget[] {
  const next = new Map(selection.map((candidate) => [sceneTargetKey(candidate), candidate] as const))
  const key = sceneTargetKey(target)
  if (next.has(key)) next.delete(key)
  else next.set(key, target)
  return normalizeSceneDesignObjectTargets(next.values())
}
