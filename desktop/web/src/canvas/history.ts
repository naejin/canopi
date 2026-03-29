import { signal } from '@preact/signals'
import { canvasClean } from '../state/design'
import type { CanvasEngine } from './engine'

export interface Command {
  readonly type: string
  execute(engine: CanvasEngine): void
  undo(engine: CanvasEngine): void
}

const MAX_HISTORY = 500

export class CanvasHistory {
  private _past: Command[] = []
  private _future: Command[] = []

  /**
   * Stack position at last save. -1 means "never saved" or "truncated past
   * saved state" — the canvas can never be clean again until the next save.
   */
  private _savedPosition = 0

  // Reactive signals for UI (undo/redo button disabled states)
  readonly canUndo = signal(false)
  readonly canRedo = signal(false)

  /** Execute a command, push to past stack, and clear redo stack. */
  execute(cmd: Command, engine: CanvasEngine): void {
    cmd.execute(engine)
    engine.reconcileMaterializedScene?.()
    this._past.push(cmd)
    this._future = []

    if (this._past.length > MAX_HISTORY) {
      this._past.shift()
      // If the saved position was in the truncated portion, it's gone forever
      if (this._savedPosition > 0) {
        this._savedPosition--
      } else {
        this._savedPosition = -1  // saved state permanently truncated away
      }
    }

    this._updateSignals()
  }

  /**
   * Record a command that has ALREADY been executed (e.g. drag, transform).
   * Pushes to past stack without calling execute() again.
   */
  record(cmd: Command): void {
    this._past.push(cmd)
    this._future = []

    if (this._past.length > MAX_HISTORY) {
      this._past.shift()
      if (this._savedPosition > 0) {
        this._savedPosition--
      } else {
        this._savedPosition = -1  // saved state permanently truncated away
      }
    }

    this._updateSignals()
  }

  undo(engine: CanvasEngine): void {
    const cmd = this._past.pop()
    if (!cmd) return
    cmd.undo(engine)
    engine.reconcileMaterializedScene?.()
    this._future.push(cmd)
    this._updateSignals()
  }

  redo(engine: CanvasEngine): void {
    const cmd = this._future.pop()
    if (!cmd) return
    cmd.execute(engine)
    engine.reconcileMaterializedScene?.()
    this._past.push(cmd)
    this._updateSignals()
  }

  clear(): void {
    this._past = []
    this._future = []
    this._savedPosition = 0
    // Only update UI signals — clear is not a document mutation.
    this.canUndo.value = false
    this.canRedo.value = false
    canvasClean.value = true
  }

  /** Called on save — remember current stack position as the clean baseline. */
  markSaved(): void {
    this._savedPosition = this._past.length
    this._updateCanvasClean()
  }

  private _updateSignals(): void {
    this.canUndo.value = this._past.length > 0
    this.canRedo.value = this._future.length > 0
    this._updateCanvasClean()
  }

  private _updateCanvasClean(): void {
    // Clean when stack length matches saved position.
    // If _savedPosition is -1, the saved state was truncated away — never clean.
    canvasClean.value =
      this._savedPosition >= 0 && this._past.length === this._savedPosition
  }
}
