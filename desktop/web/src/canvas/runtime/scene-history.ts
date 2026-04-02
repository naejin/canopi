import { signal } from '@preact/signals'
import { canvasClean } from '../../state/design'
import type { SceneCommand, SceneCommandRuntime } from './scene-commands'

const MAX_HISTORY = 500

export class SceneHistory {
  private _past: SceneCommand[] = []
  private _future: SceneCommand[] = []
  private _savedPosition = 0

  readonly canUndo = signal(false)
  readonly canRedo = signal(false)

  get isClean(): boolean {
    return this._savedPosition >= 0 && this._past.length === this._savedPosition
  }

  record(command: SceneCommand): void {
    this._past.push(command)
    this._future = []
    this._truncateIfNeeded()
    this._updateSignals()
  }

  undo(runtime: SceneCommandRuntime): void {
    const command = this._past.pop()
    if (!command) return
    command.undo(runtime)
    this._future.push(command)
    this._updateSignals()
  }

  redo(runtime: SceneCommandRuntime): void {
    const command = this._future.pop()
    if (!command) return
    command.execute(runtime)
    this._past.push(command)
    this._updateSignals()
  }

  clear(): void {
    this._past = []
    this._future = []
    this._savedPosition = 0
    this._updateSignals()
  }

  markSaved(): void {
    this._savedPosition = this._past.length
    this._updateSignals()
  }

  private _truncateIfNeeded(): void {
    if (this._past.length <= MAX_HISTORY) return
    this._past.shift()
    if (this._savedPosition > 0) this._savedPosition -= 1
    else this._savedPosition = -1
  }

  private _updateSignals(): void {
    this.canUndo.value = this._past.length > 0
    this.canRedo.value = this._future.length > 0
    canvasClean.value = this.isClean
  }
}
