// canvas/runtime/tools/select/click.ts
//
// Owns what a Select press does to the selection, at the press, with the history-free selection effect: a hit on a
// directly locked object selects it (toggles it when additive) and moves nothing; a double-click on a plant (the
// platform's click count) selects the plant's species; a double-click on a note (the platform's, or two presses within 500 ms on the host's clock and 6 px
// on the same note after a click that did not move) opens the note for editing; an additive press toggles the hit; any
// other hit is selected unless it already is and starts a move-drag; empty ground (or a hit locked through its group or
// layer) clears the selection unless additive and starts the band. Additive is Shift, Ctrl or Cmd
// (ToolModifiers.additive).

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
  | { readonly kind: 'band'; readonly additive: boolean }
  | { readonly kind: 'move'; readonly target: SceneDesignObjectTarget }
  | { readonly kind: 'edit-note'; readonly annotationId: string }
  | { readonly kind: 'done' }

/** A click that did not move, which a second press on the same note within the interval turns into a double-click. */
export interface ClickCandidate {
  readonly target: SceneDesignObjectTarget
  readonly world: WorldPoint
  readonly atMs: number
}

/** Selects for the press and says what follows. `lastClick` is the previous click that did not move. */
export function pressSelection(
  ctx: ToolContext,
  point: ToolPoint,
  rawHit: HitTarget | null,
  clickCount: number,
  lastClick: ClickCandidate | null,
  nowMs: number,
): SelectPress {
  const scene = ctx.scene.persisted
  const target = rawHit?.kind === 'object' ? rawHit.target : null
  const lockedHit = target && isDirectSceneDesignObjectLocked(scene, target) ? target : null
  const hit = target && (!isSceneDesignObjectLocked(scene, target) || lockedHit) ? target : null
  const additive = point.modifiers.additive

  if (!hit) {
    if (!additive) ctx.effects.setSelection([])
    return { kind: 'band', additive }
  }

  if (lockedHit) {
    ctx.effects.setSelection(additive ? toggleSelectionTarget(ctx.scene.selection(), lockedHit) : [lockedHit])
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
  return { kind: 'move', target: hit }
}

/** Select's own double-click on a note: the same note, within 500 ms and 6 px of the last click that did not move. */
function isNoteDoubleClick(
  ctx: ToolContext,
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
