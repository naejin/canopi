import type { ScenePersistedState, SceneStore } from '../scene'
import {
  createScenePatchCommand,
  type SceneCommandSnapshot,
} from '../scene-commands'

export type SceneEditInvalidationKind = 'scene' | 'viewport' | 'chrome'

export interface SceneEditTransaction {
  mutate(edit: (draft: ScenePersistedState) => void): void
  setSelection(ids: Iterable<string>): void
  commit(options?: { type?: string; invalidate?: SceneEditInvalidationKind }): boolean
  abort(): void
  readonly changed: boolean
}

export interface SceneEditCoordinator {
  run(type: string, edit: (tx: SceneEditTransaction) => void): boolean
  begin(type: string): SceneEditTransaction
}

interface SceneRuntimeEditCoordinatorOptions {
  sceneStore: SceneStore
  captureSnapshot(): SceneCommandSnapshot
  markDirty(before: SceneCommandSnapshot, type?: string): boolean
  setSelection(ids: Iterable<string>): void
  invalidate(kind: SceneEditInvalidationKind): void
}

export class SceneRuntimeEditCoordinator implements SceneEditCoordinator {
  private readonly _sceneStore: SceneStore
  private readonly _captureSnapshot: SceneRuntimeEditCoordinatorOptions['captureSnapshot']
  private readonly _markDirty: SceneRuntimeEditCoordinatorOptions['markDirty']
  private readonly _setSelection: SceneRuntimeEditCoordinatorOptions['setSelection']
  private readonly _invalidate: SceneRuntimeEditCoordinatorOptions['invalidate']

  constructor(options: SceneRuntimeEditCoordinatorOptions) {
    this._sceneStore = options.sceneStore
    this._captureSnapshot = options.captureSnapshot
    this._markDirty = options.markDirty
    this._setSelection = options.setSelection
    this._invalidate = options.invalidate
  }

  run(type: string, edit: (tx: SceneEditTransaction) => void): boolean {
    const tx = this.begin(type)
    try {
      edit(tx)
      return tx.commit()
    } catch (error) {
      tx.abort()
      throw error
    }
  }

  begin(type: string): SceneEditTransaction {
    return new SceneRuntimeEditTransaction({
      type,
      sceneStore: this._sceneStore,
      captureSnapshot: this._captureSnapshot,
      markDirty: this._markDirty,
      setSelection: this._setSelection,
      invalidate: this._invalidate,
    })
  }
}

interface SceneRuntimeEditTransactionOptions extends SceneRuntimeEditCoordinatorOptions {
  type: string
}

class SceneRuntimeEditTransaction implements SceneEditTransaction {
  private readonly _type: string
  private readonly _sceneStore: SceneStore
  private readonly _before: SceneCommandSnapshot
  private readonly _captureSnapshot: SceneRuntimeEditCoordinatorOptions['captureSnapshot']
  private readonly _markDirty: SceneRuntimeEditCoordinatorOptions['markDirty']
  private readonly _setSelection: SceneRuntimeEditCoordinatorOptions['setSelection']
  private readonly _invalidate: SceneRuntimeEditCoordinatorOptions['invalidate']
  private _closed = false
  private _committedChanged: boolean | null = null

  constructor(options: SceneRuntimeEditTransactionOptions) {
    this._type = options.type
    this._sceneStore = options.sceneStore
    this._captureSnapshot = options.captureSnapshot
    this._markDirty = options.markDirty
    this._setSelection = options.setSelection
    this._invalidate = options.invalidate
    this._before = options.captureSnapshot()
  }

  get changed(): boolean {
    if (this._committedChanged !== null) return this._committedChanged
    return sceneSnapshotsDiffer(this._before, this._captureSnapshot())
  }

  mutate(edit: (draft: ScenePersistedState) => void): void {
    this._assertOpen()
    this._sceneStore.updatePersisted(edit)
  }

  setSelection(ids: Iterable<string>): void {
    this._assertOpen()
    this._setSelection(ids)
  }

  commit(options: { type?: string; invalidate?: SceneEditInvalidationKind } = {}): boolean {
    this._assertOpen()
    const changed = this.changed
    if (!changed) {
      this._closed = true
      this._committedChanged = false
      return false
    }

    const committed = this._markDirty(this._before, options.type ?? this._type)
    this._closed = true
    this._committedChanged = committed
    if (committed) {
      this._invalidate(options.invalidate ?? 'scene')
    }
    return committed
  }

  abort(): void {
    if (this._closed) return
    this._closed = true
    this._sceneStore.restoreSnapshot({
      persisted: this._before.persisted,
      session: this._before.session,
    })
    this._setSelection(this._before.session.selectedEntityIds)
    this._committedChanged = false
  }

  private _assertOpen(): void {
    if (this._closed) throw new Error('Scene edit transaction is already closed')
  }
}

function sceneSnapshotsDiffer(
  before: SceneCommandSnapshot,
  after: SceneCommandSnapshot,
): boolean {
  return createScenePatchCommand('scene-edit-diff', before, after) !== null
}
