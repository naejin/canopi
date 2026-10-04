// canvas/runtime/tools/select/rotate-handle.ts
//
// Owns Select's rotation handle (the successor of interaction/selection-rotation-handle.ts): the 'rotate' ToolHandle
// centred 28 px above the selection's projected hull (today's 28 px button 14 px above it; spec §4.9): the screen box of
// the shapes it draws (select/selection-hull.ts), so on a turned map it sits above what the user sees, centred on it. The
// handle layer keeps it inside the visible map area. It is shown for a rotatable selection
// (scene-runtime/selection-rotation.ts), and its drag: one
// 'interaction-rotate' Scene Edit turning the selection about the centre of its bounds by the signed angle the pointer
// has turned since the press. With Shift (ToolModifiers.constrain) the angle steps by 15° from the press angle, relative
// as today; the host turns the point (a 'rotation-delta' constraint) and the drag rounds the angle it reads back. A turn
// of 0.25° or less changes nothing. The handle's readout is today's '+15°' chip.

import type { ToolHandleId } from '../../interaction-types'
import type { CanvasDesignObjectSelectionModel } from '../../runtime'
import {
  applyRotationTransformToDraft,
  captureRotationTransformState,
  centerOfBounds,
  isRotatableSelection,
  type RotationTransformState,
} from '../../scene-runtime/selection-rotation'
import type { SceneEditTransaction } from '../../scene-runtime/transactions'
import type { ScenePersistedState } from '../../scene/types'
import type { WorldPoint } from '../../view/types'
import type { ToolHandle } from '../draft'
import type { ToolConstraint, ToolContext, ToolPoint, ToolScene, ToolView } from '../tool'
import { selectionScreenHull } from './selection-hull'

export const ROTATE_HANDLE_ID = 'rotate' as ToolHandleId

/** Today's button: 28 px, 14 px above the selection's top edge. */
const HANDLE_RADIUS_PX = 14
const HANDLE_GAP_PX = 14
const STEP_DEG = 15
/** A turn this small is no turn: the drag commits nothing. */
const NO_OP_ROTATION_DELTA_DEG = 0.25
const CHANGE_EPSILON_DEG = 0.0001

export interface RotationDrag {
  readonly tx: SceneEditTransaction
  readonly state: RotationTransformState
  readonly pivot: WorldPoint
  readonly startDeg: number
  lastDeltaDeg: number
  /** True until the Scene Edit is committed or rolled back. */
  open: boolean
}

/** The rotation handle for `selection`, or null when it does not rotate. */
export function rotateHandle(
  scene: ToolScene,
  selection: CanvasDesignObjectSelectionModel,
  view: ToolView,
  translate: ToolContext['translate'],
  deltaDeg: number | null = null,
): ToolHandle | null {
  if (!isRotatableSelection(selection)) return null
  const hull = selectionScreenHull(scene, selection, view)
  if (!hull) return null
  const [topLeft, topRight] = hull
  return {
    id: ROTATE_HANDLE_ID,
    anchor: { x: (topLeft.x + topRight.x) / 2, y: (topLeft.y + topRight.y) / 2 },
    offsetPx: { x: 0, y: -(HANDLE_GAP_PX + HANDLE_RADIUS_PX) },
    hitRadiusPx: HANDLE_RADIUS_PX,
    glyph: 'rotate',
    label: translate('canvas.rotationHandle.label'),
    ...(deltaDeg === null ? {} : { readout: rotationReadout(deltaDeg) }),
  }
}

/** Today's readout: the whole degrees turned, signed ('+15°', '0°', '-30°'). */
export function rotationReadout(deltaDeg: number): string {
  const rounded = Math.round(deltaDeg)
  return `${rounded > 0 ? '+' : ''}${rounded}°`
}

/** A drag from the press at `start`, or null when the selection does not rotate (nothing begins). */
export function beginRotation(ctx: ToolContext, scene: Readonly<ScenePersistedState>, start: ToolPoint): RotationDrag | null {
  const selection = ctx.scene.selectionModel()
  const state = captureRotationTransformState(scene, selection)
  if (!state || !selection.bounds) return null
  const pivot = centerOfBounds(selection.bounds)
  return {
    tx: ctx.effects.edits.begin('interaction-rotate'),
    state,
    pivot,
    startDeg: angleDeg(pivot, start.world),
    lastDeltaDeg: 0,
    open: true,
  }
}

/** Shift turns the point about the pivot in 15° steps from the press angle. */
export function rotationConstraint(drag: RotationDrag): ToolConstraint {
  return { kind: 'rotation-delta', pivot: drag.pivot, startDeg: drag.startDeg, stepDeg: STEP_DEG }
}

/** Turns the selection to the pointer; returns the angle turned since the press. */
export function applyRotation(drag: RotationDrag, point: ToolPoint): number {
  const deltaDeg = rotationDeltaDeg(drag, point)
  if (Math.abs(deltaDeg - drag.lastDeltaDeg) < CHANGE_EPSILON_DEG) return deltaDeg
  drag.lastDeltaDeg = deltaDeg
  drag.tx.mutate((draft) => applyRotationTransformToDraft(draft, drag.state, drag.pivot, deltaDeg))
  return deltaDeg
}

/** Applies the release point, then commits a turn or rolls back; a failed commit is rolled back too. */
export function finishRotation(drag: RotationDrag, point: ToolPoint): void {
  if (!drag.open) return
  const deltaDeg = applyRotation(drag, point)
  if (Math.abs(deltaDeg) <= NO_OP_ROTATION_DELTA_DEG || !drag.tx.changed) {
    abortRotation(drag)
    return
  }
  try {
    drag.tx.commit({ invalidate: 'scene' })
    drag.open = false
  } catch (error) {
    try {
      abortRotation(drag)
    } catch {
      // The commit's failure is the one reported; a failed rollback leaves the drag open for the next retry.
    }
    throw error
  }
}

/** Rolls the selection back; throws, still open, when the abort fails. */
export function abortRotation(drag: RotationDrag): void {
  if (!drag.open) return
  drag.tx.abort()
  drag.open = false
}

/** The signed angle turned since the press, in 15° steps with Shift. */
function rotationDeltaDeg(drag: RotationDrag, point: ToolPoint): number {
  const constrained = point.modifiers.constrain
  const deltaDeg = signedAngleDeltaDeg(drag.startDeg, angleDeg(drag.pivot, constrained ? point.constrained : point.world))
  // The host turned the point to a step; reading the angle back leaves a rounding error the step removes.
  return constrained ? Math.round(deltaDeg / STEP_DEG) * STEP_DEG : deltaDeg
}

function angleDeg(center: WorldPoint, point: WorldPoint): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI
}

function signedAngleDeltaDeg(startDeg: number, currentDeg: number): number {
  let delta = (currentDeg - startDeg) % 360
  if (delta > 180) delta -= 360
  if (delta <= -180) delta += 360
  return delta
}
