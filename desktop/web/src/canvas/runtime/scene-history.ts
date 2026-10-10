import { batch, signal } from '@preact/signals'
import { runCanvasRuntimeCleanups } from './cleanup'
import type { SceneCommand } from './scene-commands'

const MAX_HISTORY = 500

interface SceneHistoryOptions {
  readonly reportCleanState?: (clean: boolean) => void
}

type SceneHistoryReplayDirection = 'undo' | 'redo'

interface SceneHistoryEntry {
  readonly command: SceneCommand
  readonly beforeState: object
  readonly afterState: object
}

declare const sceneHistoryCheckpointBrand: unique symbol

export interface SceneHistoryCheckpoint {
  readonly [sceneHistoryCheckpointBrand]: true
}

interface SceneHistoryCheckpointState {
  readonly generation: number
  readonly state: object
}

export type SceneHistoryAcknowledgement = 'applied' | 'stale'

export class SceneHistory {
  private _past: SceneHistoryEntry[] = []
  private _future: SceneHistoryEntry[] = []
  private _currentState: object = {}
  private _savedState: object = this._currentState
  private _generation = 0
  private _checkpoints = new WeakMap<SceneHistoryCheckpoint, SceneHistoryCheckpointState>()
  private readonly _reportCleanState: (clean: boolean) => void

  readonly canUndo = signal(false)
  readonly canRedo = signal(false)

  constructor(options: SceneHistoryOptions = {}) {
    this._reportCleanState = options.reportCleanState ?? (() => {})
  }

  get isClean(): boolean {
    return this._currentState === this._savedState
  }

  /**
   * Accepts the command (an array step that cannot fail), tells `accepted`, then publishes `canUndo`, `canRedo` and the
   * clean state. A publication throw leaves the command recorded.
   */
  record(command: SceneCommand, accepted: () => void): void {
    this._past.push({ command, beforeState: this._currentState, afterState: {} })
    this._future = []
    this._currentState = this._past.at(-1)!.afterState
    this._truncateIfNeeded()
    accepted()
    this._updateSignals()
  }

  /**
   * Moves the cursor back one step (an array step), hands its command to `apply` (the Scene's store update), then
   * publishes as `record` does. When `apply` throws the cursor moves back and the error propagates; a publication
   * throw keeps the step. Returns the command, or null when there is nothing to undo.
   */
  undo(apply: (command: SceneCommand) => void): SceneCommand | null {
    return this._replay('undo', apply)
  }

  /** As `undo`, one step forward. */
  redo(apply: (command: SceneCommand) => void): SceneCommand | null {
    return this._replay('redo', apply)
  }

  clear(): void {
    this._past = []
    this._future = []
    this._generation += 1
    this._currentState = {}
    this._savedState = this._currentState
    this._updateSignals()
  }

  // Re-expresses every recorded command after a session plane change. Only
  // called while settled, so no record or replay operation is in flight.
  remapCommands(map: (command: SceneCommand) => SceneCommand): void {
    const remap = (entry: SceneHistoryEntry): SceneHistoryEntry => ({ ...entry, command: map(entry.command) })
    this._past = this._past.map(remap)
    this._future = this._future.map(remap)
  }

  captureCheckpoint(): SceneHistoryCheckpoint {
    const checkpoint = Object.freeze({}) as SceneHistoryCheckpoint
    this._checkpoints.set(checkpoint, { generation: this._generation, state: this._currentState })
    return checkpoint
  }

  isCheckpointCurrent(checkpoint: SceneHistoryCheckpoint): boolean {
    const state = this._checkpoints.get(checkpoint)
    if (!state) throw new Error('Cannot inspect a foreign Scene history checkpoint')
    return state.generation === this._generation && state.state === this._currentState
  }

  acknowledgeSaved(checkpoint: SceneHistoryCheckpoint): SceneHistoryAcknowledgement {
    const state = this._checkpoints.get(checkpoint)
    if (!state) throw new Error('Cannot acknowledge a foreign Scene history checkpoint')
    if (state.generation !== this._generation) return 'stale'
    this._savedState = state.state
    this._updateSignals()
    return 'applied'
  }

  private _truncateIfNeeded(): void {
    if (this._past.length <= MAX_HISTORY) return
    this._past.shift()
  }

  private _replay(direction: SceneHistoryReplayDirection, apply: (command: SceneCommand) => void): SceneCommand | null {
    const from = direction === 'undo' ? this._past : this._future
    const to = direction === 'undo' ? this._future : this._past
    const entry = from.pop()
    if (!entry) return null
    const previousState = this._currentState
    to.push(entry)
    this._currentState = direction === 'undo' ? entry.beforeState : entry.afterState
    try {
      apply(entry.command)
    } catch (error) {
      to.pop()
      from.push(entry)
      this._currentState = previousState
      throw error
    }
    this._updateSignals()
    return entry.command
  }

  /** Publishes `canUndo`/`canRedo` and the clean state; each step runs once and their errors are rethrown together. */
  private _updateSignals(): void {
    runCanvasRuntimeCleanups([
      () => batch(() => {
        this.canUndo.value = this._past.length > 0
        this.canRedo.value = this._future.length > 0
      }),
      () => this._reportCleanState(this.isClean),
    ], 'Scene history failed to publish')
  }
}
