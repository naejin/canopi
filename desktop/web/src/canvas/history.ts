import { signal } from '@preact/signals'
import { designDirty } from '../state/design'
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

  // Reactive signals for UI (undo/redo button disabled states)
  readonly canUndo = signal(false)
  readonly canRedo = signal(false)

  /** Execute a command, push to past stack, and clear redo stack. */
  execute(cmd: Command, engine: CanvasEngine): void {
    cmd.execute(engine)
    this._past.push(cmd)
    this._future = []

    if (this._past.length > MAX_HISTORY) {
      this._past.shift()
    }

    this._updateSignals()
    designDirty.value = true
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
    }

    this._updateSignals()
    designDirty.value = true
  }

  undo(engine: CanvasEngine): void {
    const cmd = this._past.pop()
    if (!cmd) return
    cmd.undo(engine)
    this._future.push(cmd)
    this._updateSignals()
    designDirty.value = this._past.length > 0
  }

  redo(engine: CanvasEngine): void {
    const cmd = this._future.pop()
    if (!cmd) return
    cmd.execute(engine)
    this._past.push(cmd)
    this._updateSignals()
    designDirty.value = true
  }

  clear(): void {
    this._past = []
    this._future = []
    this._updateSignals()
  }

  private _updateSignals(): void {
    this.canUndo.value = this._past.length > 0
    this.canRedo.value = this._future.length > 0
  }
}
