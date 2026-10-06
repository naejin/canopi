// canvas/runtime/tools/select/point-handle.ts
//
// Owns the drag of one point handle of a selected object (a zone's corner, vertex or axis end, a guide's end); the
// handles' DOM is the chrome's handle layer. One Scene Edit from the press, nothing applied until the pointer has moved
// more than 2 px on screen from the press, the snapped point applied to a copy of the object as it was at the press, and
// a commit only when the object changed. A cancelled drag rolls the object back.

import type { SceneEditTransaction } from '../../scene-runtime/transactions'
import type { ScenePersistedState } from '../../scene/types'
import type { WorldPoint } from '../../view/types'
import type { ToolContext, ToolPoint } from '../tool'

/** A point handle applies nothing until the pointer has moved this far from the press. */
const DRAG_THRESHOLD_PX = 2

/** What a point handle edits: one object, reshaped from its state at the press. */
export interface PointHandleSubject<TEntity> {
  readonly editType: string
  readonly entityId: string
  /** The object at the press (a copy). */
  readonly start: TEntity
  /** The object with the handle's point at `dragged`, or null where the shape would be too small. */
  reshape(start: TEntity, dragged: WorldPoint): TEntity | null
  equal(left: TEntity, right: TEntity): boolean
  write(draft: ScenePersistedState, entityId: string, entity: TEntity): void
}

export interface PointHandleDrag<TEntity> {
  /** The object as last applied, or null before the pointer passed the threshold. */
  readonly current: TEntity | null
  /** True until the Scene Edit is committed or rolled back. */
  readonly open: boolean
  move(point: ToolPoint): void
  /** Applies the release point, then commits a change or rolls back. */
  finish(point: ToolPoint): void
  /** Rolls the object back; throws, still open, when the abort fails. */
  cancel(): void
}

export function beginPointHandleDrag<TEntity>(
  ctx: ToolContext,
  subject: PointHandleSubject<TEntity>,
  start: ToolPoint,
): PointHandleDrag<TEntity> {
  const tx: SceneEditTransaction = ctx.effects.edits.begin(subject.editType)
  let current: TEntity | null = null
  let changed = false
  let moved = false
  let open = true

  function pastThreshold(point: ToolPoint): boolean {
    return ctx.view.screenDistance(start.world, point.world) > DRAG_THRESHOLD_PX
  }

  function apply(point: ToolPoint): void {
    const next = subject.reshape(subject.start, point.snapped)
    if (!next) return
    changed = changed || !subject.equal(subject.start, next)
    current = next
    tx.mutate((draft) => subject.write(draft, subject.entityId, next))
  }

  function abort(): void {
    tx.abort()
    open = false
  }

  return {
    get current() {
      return current
    },
    get open() {
      return open
    },
    move(point) {
      if (!open || (!moved && !pastThreshold(point))) return
      moved = true
      apply(point)
    },
    finish(point) {
      if (!open) return
      if (moved || pastThreshold(point)) apply(point)
      if (!changed || !tx.changed) {
        abort()
        return
      }
      open = false
      tx.commit()
    },
    cancel() {
      if (open) abort()
    },
  }
}
