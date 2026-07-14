import { signal } from '@preact/signals'
import type { SceneCommand } from './scene-commands'

const MAX_HISTORY = 500

interface SceneHistoryOptions {
  readonly reportCleanState?: (clean: boolean) => void
}

interface SceneHistoryRecordState {
  readonly entry: SceneHistoryEntry
  cursorApplied: boolean
  publicationApplied: boolean
}

type SceneHistoryReplayDirection = 'undo' | 'redo'

interface SceneHistoryReplayState {
  readonly direction: SceneHistoryReplayDirection
  readonly entry: SceneHistoryEntry
  sceneApplied: boolean
  cursorApplied: boolean
  publicationApplied: boolean
}

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
  baselineApplied: boolean
  publicationApplied: boolean
}

export type SceneHistoryAcknowledgement = 'applied' | 'stale'

export class SceneHistory {
  private _past: SceneHistoryEntry[] = []
  private _future: SceneHistoryEntry[] = []
  private _currentState: object = {}
  private _savedState: object = this._currentState
  private _generation = 0
  private _checkpoints = new WeakMap<SceneHistoryCheckpoint, SceneHistoryCheckpointState>()
  private _recordOperations = new WeakMap<object, SceneHistoryRecordState>()
  private _replayOperations = new WeakMap<object, SceneHistoryReplayState>()
  private _directRecord: { command: SceneCommand; token: object } | null = null
  private _directReplay: { direction: SceneHistoryReplayDirection; token: object } | null = null
  private readonly _reportCleanState: (clean: boolean) => void

  readonly canUndo = signal(false)
  readonly canRedo = signal(false)

  constructor(options: SceneHistoryOptions = {}) {
    this._reportCleanState = options.reportCleanState ?? (() => {})
  }

  get isClean(): boolean {
    return this._currentState === this._savedState
  }

  record(command: SceneCommand, transaction?: object): boolean {
    const token = transaction ?? this._directRecordToken(command)
    let state = this._recordOperations.get(token)
    if (!state) {
      state = {
        entry: {
          command,
          beforeState: this._currentState,
          afterState: {},
        },
        cursorApplied: false,
        publicationApplied: false,
      }
      this._recordOperations.set(token, state)
    }

    const newlyRecorded = !state.cursorApplied
    if (!state.cursorApplied) {
      this._past.push(state.entry)
      this._future = []
      this._currentState = state.entry.afterState
      this._truncateIfNeeded()
      state.cursorApplied = true
    }
    if (!state.publicationApplied) {
      this._updateSignals()
      state.publicationApplied = true
    }
    if (!transaction) this._directRecord = null
    return newlyRecorded
  }

  hasRecorded(transaction: object): boolean {
    return this._recordOperations.get(transaction)?.cursorApplied === true
  }

  undo(apply: (command: SceneCommand) => void, operation?: object): boolean {
    return this._replay('undo', apply, operation)
  }

  redo(apply: (command: SceneCommand) => void, operation?: object): boolean {
    return this._replay('redo', apply, operation)
  }

  clear(): void {
    this._past = []
    this._future = []
    this._recordOperations = new WeakMap<object, SceneHistoryRecordState>()
    this._replayOperations = new WeakMap<object, SceneHistoryReplayState>()
    this._directRecord = null
    this._directReplay = null
    this._generation += 1
    this._currentState = {}
    this._savedState = this._currentState
    this._updateSignals()
  }

  captureCheckpoint(): SceneHistoryCheckpoint {
    const checkpoint = Object.freeze({}) as SceneHistoryCheckpoint
    this._checkpoints.set(checkpoint, {
      generation: this._generation,
      state: this._currentState,
      baselineApplied: false,
      publicationApplied: false,
    })
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

    if (!state.baselineApplied) {
      this._savedState = state.state
      state.baselineApplied = true
    }
    if (!state.publicationApplied) {
      this._updateSignals()
      state.publicationApplied = true
    }
    return 'applied'
  }

  private _truncateIfNeeded(): void {
    if (this._past.length <= MAX_HISTORY) return
    this._past.shift()
  }

  private _replay(
    direction: SceneHistoryReplayDirection,
    apply: (command: SceneCommand) => void,
    operation?: object,
  ): boolean {
    const token = operation ?? this._directReplayToken(direction)
    let state = this._replayOperations.get(token)
    if (!state) {
      const entry = direction === 'undo' ? this._past.at(-1) : this._future.at(-1)
      if (!entry) {
        if (!operation) this._directReplay = null
        return false
      }
      state = {
        direction,
        entry,
        sceneApplied: false,
        cursorApplied: false,
        publicationApplied: false,
      }
      this._replayOperations.set(token, state)
    }
    if (state.direction !== direction) {
      throw new Error(`Scene history ${state.direction} is still finalizing`)
    }

    if (!state.sceneApplied) {
      apply(state.entry.command)
      state.sceneApplied = true
    }
    if (!state.cursorApplied) {
      this._applyReplayCursor(state)
      state.cursorApplied = true
    }
    if (!state.publicationApplied) {
      this._updateSignals()
      state.publicationApplied = true
    }
    if (!operation) this._directReplay = null
    return true
  }

  private _directReplayToken(direction: SceneHistoryReplayDirection): object {
    if (this._directReplay?.direction === direction) return this._directReplay.token
    if (this._directReplay) {
      throw new Error(`Scene history ${this._directReplay.direction} is still finalizing`)
    }
    const token = {}
    this._directReplay = { direction, token }
    return token
  }

  private _directRecordToken(command: SceneCommand): object {
    if (this._directRecord) {
      if (this._directRecord.command !== command) {
        throw new Error('Scene history record publication is still finalizing')
      }
      return this._directRecord.token
    }
    const token = {}
    this._directRecord = { command, token }
    return token
  }

  private _applyReplayCursor(state: SceneHistoryReplayState): void {
    if (state.direction === 'undo') {
      if (this._past.at(-1) !== state.entry) {
        throw new Error('Scene history changed while undo was finalizing')
      }
      this._past.pop()
      this._future.push(state.entry)
      this._currentState = state.entry.beforeState
      return
    }
    if (this._future.at(-1) !== state.entry) {
      throw new Error('Scene history changed while redo was finalizing')
    }
    this._future.pop()
    this._past.push(state.entry)
    this._currentState = state.entry.afterState
  }

  private _updateSignals(): void {
    this.canUndo.value = this._past.length > 0
    this.canRedo.value = this._future.length > 0
    this._reportCleanState(this.isClean)
  }
}
