import { batch, computed, signal, type ReadonlySignal } from '@preact/signals'
import type { GeoPosition } from '../../session-plane'

import type { CanopiFile } from '../../../types/design'
import { throwCanvasRuntimeCleanupErrors } from '../cleanup'
import {
  CanvasAuthorityBusyError,
  CanvasDocumentReplacementNotAdmittedError,
  type CanvasDocumentReplacementToken,
} from '../runtime'
import type { SceneHistory } from '../scene-history'
import {
  cloneScenePersistedState,
  type SceneDesignObjectTarget,
  type ScenePersistedState,
  type SceneGeoFrame,
  type SceneStore,
} from '../scene'
import {
  applySceneCommandPersistedPatch,
  createScenePatchCommand,
  type SceneCommand,
  type SceneCommandPatch,
  type SceneCommandSnapshot,
} from '../scene-commands'

export type SceneEditInvalidationKind = 'scene' | 'viewport' | 'chrome'

export interface SceneEditTransaction {
  mutate(edit: (draft: ScenePersistedState) => void): void
  setSelection(targets: Iterable<SceneDesignObjectTarget>): void
  commit(options?: { type?: string; invalidate?: SceneEditInvalidationKind }): boolean
  abort(): void
  readonly changed: boolean
}

export interface SceneEditRunOptions {
  readonly invalidate?: SceneEditInvalidationKind
  readonly onCommitted?: () => void
}

export interface SceneEditCoordinator {
  run(
    type: string,
    edit: (tx: SceneEditTransaction) => void,
    options?: SceneEditRunOptions,
  ): boolean
  begin(
    type: string,
    options?: Pick<SceneEditRunOptions, 'onCommitted'>,
  ): SceneEditTransaction
}

export interface SceneCommandAdmission {
  readonly revision: ReadonlySignal<number>
  runWhenSettled<T>(
    operation: () => T,
    busyResult: T,
    options?: { resumePending?: boolean },
  ): T
}

export interface SettledSceneReader {
  readonly revision: ReadonlySignal<number>
  readWhenSettled<T>(operation: () => T, busyResult: T): T
}

export interface SceneHistoryCommands {
  readonly canUndo: ReadonlySignal<boolean>
  readonly canRedo: ReadonlySignal<boolean>
  undo(): boolean
  redo(): boolean
}

type ScenePersistenceAcknowledgement = 'applied' | 'stale'

export interface ScenePersistenceCapture {
  readonly scene: ScenePersistedState
  readonly geo: SceneGeoFrame
  isCurrent(): boolean
  acknowledgeSaved(): ScenePersistenceAcknowledgement
}

export interface ScenePersistenceAuthority {
  capturePersistence(): ScenePersistenceCapture
  disposePersistence(): void
}

export interface SceneDocumentAuthority {
  hydrate(
    file: CanopiFile,
    syncDocumentSignals?: (file: CanopiFile) => void,
  ): void
  replaceDocument(file: CanopiFile, stages: SceneDocumentReplacementStages): boolean
}

export interface SceneDocumentReplacementStages {
  readonly token: CanvasDocumentReplacementToken
  readonly prepare: () => void
  readonly syncDocumentSignals?: (file: CanopiFile) => void
  readonly finalizeReplacement?: () => void
}

type SceneRuntimeAuthority = SceneEditCoordinator
  & SceneCommandAdmission
  & SettledSceneReader
  & SceneHistoryCommands
  & ScenePersistenceAuthority
  & SceneDocumentAuthority

export class SceneEditBusyError extends CanvasAuthorityBusyError {
  constructor(activeType: string) {
    super(activeType, `Scene edit ${activeType} already owns the Scene`)
    this.name = 'SceneEditBusyError'
  }
}

interface SceneRuntimeEditCoordinatorOptions {
  sceneStore: SceneStore
  history: SceneHistory
  setSelection(targets: Iterable<SceneDesignObjectTarget>): void
  incrementSceneRevision(): void
  syncCanvasSignalsFromScene(): void
  invalidate(kind: SceneEditInvalidationKind): void
}

interface SceneAuthorityOperation {
  readonly type: string
}

interface PendingImmediateEdit {
  readonly type: string
  readonly transaction: SceneRuntimeEditTransaction
  readonly failure: unknown
  resuming: boolean
}

export class SceneRuntimeEditCoordinator implements SceneRuntimeAuthority {
  private readonly _sceneStore: SceneStore
  private readonly _history: SceneHistory
  private readonly _setSelection: SceneRuntimeEditCoordinatorOptions['setSelection']
  private readonly _incrementSceneRevision: SceneRuntimeEditCoordinatorOptions['incrementSceneRevision']
  private readonly _syncCanvasSignalsFromScene: SceneRuntimeEditCoordinatorOptions['syncCanvasSignalsFromScene']
  private readonly _invalidate: SceneRuntimeEditCoordinatorOptions['invalidate']
  private readonly _admissionRevision = signal(0)
  private _active: SceneAuthorityOperation | null = null
  private _replacementHandoff: {
    readonly predecessor: SceneRuntimeEditTransaction
    readonly successor: SceneHydrationSettlement
  } | null = null
  private _pendingImmediate: PendingImmediateEdit | null = null
  private _documentGeneration = 0
  private _persistenceEpoch = 0
  private _persistenceDisposed = false

  readonly revision: ReadonlySignal<number> = this._admissionRevision
  readonly canUndo = computed(() => {
    void this._admissionRevision.value
    return this._active === null
      && this._history.canUndo.value
  })
  readonly canRedo = computed(() => {
    void this._admissionRevision.value
    return this._active === null
      && this._history.canRedo.value
  })

  constructor(options: SceneRuntimeEditCoordinatorOptions) {
    this._sceneStore = options.sceneStore
    this._history = options.history
    this._setSelection = options.setSelection
    this._incrementSceneRevision = options.incrementSceneRevision
    this._syncCanvasSignalsFromScene = options.syncCanvasSignalsFromScene
    this._invalidate = options.invalidate
  }

  runWhenSettled<T>(
    operation: () => T,
    busyResult: T,
    options: { resumePending?: boolean } = {},
  ): T {
    if (this._active) {
      if (options.resumePending) {
        if (this._pendingImmediate) {
          this._resumePendingImmediate(this._pendingImmediate)
        } else if (this._active instanceof SceneHistoryReplay) {
          this._active.resume()
        }
      }
      return busyResult
    }
    return operation()
  }

  readWhenSettled<T>(operation: () => T, busyResult: T): T {
    if (this._active) return busyResult
    return operation()
  }

  run(
    type: string,
    edit: (tx: SceneEditTransaction) => void,
    options: SceneEditRunOptions = {},
  ): boolean {
    if (this._active) {
      if (this._pendingImmediate) {
        this._resumePendingImmediate(this._pendingImmediate)
      }
      return false
    }
    const tx = this._begin(type, options.onCommitted)
    try {
      edit(tx)
    } catch (error) {
      const pending = { type, transaction: tx, failure: error, resuming: false }
      this._pendingImmediate = pending
      pending.resuming = true
      try {
        try {
          tx.abort()
        } catch (firstAbortError) {
          try {
            tx.abort()
          } catch (secondAbortError) {
            this._throwSettlementErrors(
              [error, firstAbortError, secondAbortError],
              `Scene edit ${type} failed and could not be settled`,
            )
          }
        }
      } finally {
        pending.resuming = false
      }
      return this._finishPendingImmediate(pending)
    }

    try {
      return tx.commit({ invalidate: options.invalidate })
    } catch (error) {
      const pending = { type, transaction: tx, failure: error, resuming: false }
      this._pendingImmediate = pending
      pending.resuming = true
      try {
        try {
          tx.abort()
        } catch (settlementError) {
          this._throwSettlementErrors(
            [error, settlementError],
            `Scene edit ${type} failed and could not be settled`,
          )
        }
      } finally {
        pending.resuming = false
      }
      return this._finishPendingImmediate(pending)
    }
  }

  begin(
    type: string,
    options: Pick<SceneEditRunOptions, 'onCommitted'> = {},
  ): SceneEditTransaction {
    return this._begin(type, options.onCommitted)
  }

  private _begin(type: string, onCommitted: () => void = () => {}): SceneRuntimeEditTransaction {
    if (this._active) throw new SceneEditBusyError(this._active.type)
    const transaction = new SceneRuntimeEditTransaction({
      type,
      sceneStore: this._sceneStore,
      captureSnapshot: () => this._captureSnapshot(),
      setSelection: this._setSelection,
      recordHistory: (command, token) => {
        this._history.record(command, token)
      },
      wasHistoryRecorded: (token) => this._history.hasRecorded(token),
      syncCanvasSignalsFromScene: this._syncCanvasSignalsFromScene,
      incrementSceneRevision: this._incrementSceneRevision,
      invalidate: this._invalidate,
      onCommitted,
      restore: (snapshot) => this._restore(snapshot),
      release: (settled) => this._release(settled),
    })
    this._acquire(transaction)
    return transaction
  }

  undo(): boolean {
    if (this._active) {
      return this._active instanceof SceneHistoryReplay
        && this._active.direction === 'undo'
        ? this._active.resume()
        : false
    }
    if (!this._history.canUndo.value) return false
    const replay = this._createHistoryReplay('undo')
    this._acquire(replay)
    return replay.resume()
  }

  redo(): boolean {
    if (this._active) {
      return this._active instanceof SceneHistoryReplay
        && this._active.direction === 'redo'
        ? this._active.resume()
        : false
    }
    if (!this._history.canRedo.value) return false
    const replay = this._createHistoryReplay('redo')
    this._acquire(replay)
    return replay.resume()
  }

  /**
   * Rebuilds the session plane at `origin` while settled. The scene and every
   * undo command move through one reprojector, so stored lon/lat is unchanged
   * and nothing is dirtied or recorded; the camera follows through the plane
   * effect. When not settled it does nothing.
   */
  reoriginSessionPlane(origin: GeoPosition): void {
    if (
      this._persistenceDisposed
      || this._active
      || this._replacementHandoff
    ) return
    const reprojector = this._sceneStore.beginReorigin(origin)
    const reprojectPatch = (patch: SceneCommandPatch): SceneCommandPatch => patch.persisted
      ? { ...patch, persisted: reprojector.persisted(patch.persisted) }
      : patch
    batch(() => {
      this._history.remapCommands((command) => ({
        ...command,
        before: reprojectPatch(command.before),
        after: reprojectPatch(command.after),
      }))
      this._sceneStore.commitReorigin(reprojector)
      this._incrementSceneRevision()
      this._invalidate('scene')
    })
  }

  capturePersistence(): ScenePersistenceCapture {
    if (this._persistenceDisposed) {
      throw new SceneEditBusyError('runtime-disposed')
    }
    if (this._replacementHandoff || this._active instanceof SceneHydrationSettlement) {
      throw new SceneEditBusyError(this._active?.type ?? 'document-replacement')
    }
    if (this._active && !(this._active instanceof SceneRuntimeEditTransaction)) {
      throw new SceneEditBusyError(this._active.type)
    }

    const scene = this._active instanceof SceneRuntimeEditTransaction
      && !this._history.hasRecorded(this._active)
      ? this._active.captureCommittedPersistedState()
      : this._sceneStore.persisted
    const checkpoint = this._history.captureCheckpoint()
    const documentGeneration = this._documentGeneration
    const persistenceEpoch = this._persistenceEpoch
    let acknowledgement: ScenePersistenceAcknowledgement | null = null
    const captureIsCurrent = () => !this._persistenceDisposed
      && documentGeneration === this._documentGeneration
      && persistenceEpoch === this._persistenceEpoch
      && this._history.isCheckpointCurrent(checkpoint)

    return Object.freeze({
      scene: cloneScenePersistedState(scene),
      geo: this._sceneStore.geoFrame,
      isCurrent: captureIsCurrent,
      acknowledgeSaved: (): ScenePersistenceAcknowledgement => {
        if (acknowledgement) return acknowledgement
        if (
          this._persistenceDisposed
          || documentGeneration !== this._documentGeneration
          || persistenceEpoch !== this._persistenceEpoch
        ) {
          acknowledgement = 'stale'
          return acknowledgement
        }
        const historyAcknowledgement = this._history.acknowledgeSaved(checkpoint)
        acknowledgement = historyAcknowledgement === 'stale'
          || this._persistenceDisposed
          || documentGeneration !== this._documentGeneration
          || persistenceEpoch !== this._persistenceEpoch
          ? 'stale'
          : 'applied'
        return acknowledgement
      },
    })
  }

  disposePersistence(): void {
    if (this._persistenceDisposed) return
    this._persistenceDisposed = true
    this._persistenceEpoch += 1
  }

  hydrate(
    file: CanopiFile,
    syncDocumentSignals: (file: CanopiFile) => void = () => {},
  ): void {
    if (this._active instanceof SceneHydrationSettlement) {
      if (
        !this._active.matches(file, 'document-hydration')
        || !this._active.canRetry
      ) {
        throw new SceneEditBusyError(this._active.type)
      }
      this._active.resume()
      return
    }
    const recoveredType = this._resumeRecoverableActive()
    if (recoveredType) throw new SceneEditBusyError(recoveredType)
    if (this._active) throw new SceneEditBusyError(this._active.type)
    const ownedFile = cloneDocument(file)
    const hydration = new SceneHydrationSettlement({
      type: 'document-hydration',
      file: ownedFile,
      sceneStore: this._sceneStore,
      history: this._history,
      noteStoreHydrated: () => this._noteStoreHydrated(),
      syncDocumentSignals: () => syncDocumentSignals(cloneDocument(ownedFile)),
      syncCanvasSignalsFromScene: this._syncCanvasSignalsFromScene,
      invalidate: this._invalidate,
      incrementSceneRevision: this._incrementSceneRevision,
      release: (settled) => this._release(settled),
    })
    this._acquire(hydration)
    hydration.beginHydration()
  }

  replaceDocument(file: CanopiFile, stages: SceneDocumentReplacementStages): boolean {
    if (this._active instanceof SceneHydrationSettlement) {
      const active = this._active
      if (!active.canRetry || active.type !== 'document-replacement') {
        throw new SceneEditBusyError(active.type)
      }
      if (!active.matches(file, 'document-replacement', stages.token)) {
        active.resume()
        throw new SceneEditBusyError(active.type)
      }
      active.resume()
      return false
    }

    if (this._replacementHandoff) {
      throw new SceneEditBusyError(this._replacementHandoff.successor.type)
    }

    const recoveredType = this._resumeRecoverableActive()
    if (recoveredType) throw new SceneEditBusyError(recoveredType)

    const predecessor = this._active
    if (predecessor && !(predecessor instanceof SceneRuntimeEditTransaction)) {
      throw new SceneEditBusyError(predecessor.type)
    }
    const ownedFile = cloneDocument(file)
    const replacement = new SceneHydrationSettlement({
      type: 'document-replacement',
      token: stages.token,
      file: ownedFile,
      sceneStore: this._sceneStore,
      history: this._history,
      noteStoreHydrated: () => this._noteStoreHydrated(),
      syncDocumentSignals: () => {
        stages.syncDocumentSignals?.(cloneDocument(ownedFile))
      },
      syncCanvasSignalsFromScene: this._syncCanvasSignalsFromScene,
      invalidate: this._invalidate,
      incrementSceneRevision: this._incrementSceneRevision,
      finalizeReplacement: stages.finalizeReplacement,
      release: (settled) => this._release(settled),
    })

    if (predecessor) {
      this._replacementHandoff = { predecessor, successor: replacement }
    } else {
      this._acquire(replacement)
    }

    try {
      stages.prepare()
      if (this._active !== replacement) {
        throw new SceneEditBusyError(predecessor?.type ?? replacement.type)
      }
      replacement.beginHydration()
      return stages.finalizeReplacement !== undefined
    } catch (error) {
      if (replacement.canRetry) throw error
      this._cancelReplacementBeforeHydration(replacement)
      if (error instanceof CanvasDocumentReplacementNotAdmittedError) throw error
      throw new CanvasDocumentReplacementNotAdmittedError(error)
    }
  }

  private _captureSnapshot(): SceneCommandSnapshot {
    return {
      persisted: this._sceneStore.persisted,
      selectedTargets: this._sceneStore.session.selectedTargets,
    }
  }

  private _resumeRecoverableActive(): string | null {
    if (!this._active) return null
    const activeType = this._active.type
    if (this._pendingImmediate) {
      this._resumePendingImmediate(this._pendingImmediate)
      return activeType
    }
    if (this._active instanceof SceneHistoryReplay) {
      this._active.resume()
      return activeType
    }
    if (
      this._active instanceof SceneRuntimeEditTransaction
      && this._active.isCommitting
    ) {
      this._active.abort()
      return activeType
    }
    return null
  }

  private _cancelReplacementBeforeHydration(replacement: SceneHydrationSettlement): void {
    if (this._replacementHandoff?.successor === replacement) {
      this._replacementHandoff = null
    }
    if (this._active === replacement) this._release(replacement)
  }

  private _restore(snapshot: SceneCommandSnapshot): void {
    const rollback = createScenePatchCommand(
      'scene-edit-abort',
      snapshot,
      this._captureSnapshot(),
    )
    if (rollback) this._applyPatch(rollback.before)
  }

  private _applyPatch(patch: SceneCommandPatch): void {
    if (patch.persisted) {
      this._sceneStore.updatePersisted((draft) => {
        applySceneCommandPersistedPatch(draft, patch)
      })
    }
    if (patch.selection) this._setSelection(patch.selection)
  }

  private _createHistoryReplay(direction: SceneHistoryReplayDirection): SceneHistoryReplay {
    return new SceneHistoryReplay({
      direction,
      history: this._history,
      applyPatch: (patch) => this._applyPatch(patch),
      syncCanvasSignalsFromScene: this._syncCanvasSignalsFromScene,
      incrementSceneRevision: this._incrementSceneRevision,
      invalidate: this._invalidate,
      release: (settled) => this._release(settled),
    })
  }

  private _noteStoreHydrated(): void {
    this._documentGeneration += 1
  }

  private _acquire(operation: SceneAuthorityOperation): void {
    this._active = operation
    this._publishAdmissionRevision()
  }

  private _resumePendingImmediate(pending: PendingImmediateEdit): boolean {
    if (pending.resuming) return false
    pending.resuming = true
    try {
      try {
        pending.transaction.abort()
      } catch (settlementError) {
        this._throwSettlementErrors(
          [pending.failure, settlementError],
          `Scene edit ${pending.type} still could not be settled`,
        )
      }
      return this._finishPendingImmediate(pending)
    } finally {
      pending.resuming = false
    }
  }

  private _finishPendingImmediate(pending: PendingImmediateEdit): boolean {
    const outcome = pending.transaction.outcome
    if (outcome === 'committed' || outcome === 'aborted') {
      if (this._pendingImmediate === pending) this._pendingImmediate = null
      if (outcome === 'committed') return pending.transaction.committedChanged
      throw pending.failure
    }
    throw new Error(`Scene edit ${pending.type} did not reach an authoritative outcome`)
  }

  private _throwSettlementErrors(errors: readonly unknown[], message: string): never {
    throwCanvasRuntimeCleanupErrors(errors, message)
    throw new Error(message)
  }

  private _release(operation: SceneAuthorityOperation): void {
    if (this._active !== operation) return
    const handoff = this._replacementHandoff
    if (handoff?.predecessor === operation) {
      this._replacementHandoff = null
      this._active = handoff.successor
    } else {
      this._active = null
    }
    if (this._pendingImmediate?.transaction === operation) this._pendingImmediate = null
    this._publishAdmissionRevision()
  }

  private _publishAdmissionRevision(): void {
    try {
      this._admissionRevision.value += 1
    } catch {
      // Reactive consumers observe authority state; they must never own its lifecycle.
      // The signal value still advanced, so a later read sees the settled state.
    }
  }
}

type SceneHistoryReplayDirection = 'undo' | 'redo'

interface SceneHistoryReplayOptions {
  readonly direction: SceneHistoryReplayDirection
  readonly history: SceneHistory
  readonly applyPatch: (patch: SceneCommandPatch) => void
  readonly syncCanvasSignalsFromScene: () => void
  readonly incrementSceneRevision: () => void
  readonly invalidate: (kind: SceneEditInvalidationKind) => void
  readonly release: (replay: SceneHistoryReplay) => void
}

class SceneHistoryReplay implements SceneAuthorityOperation {
  readonly direction: SceneHistoryReplayDirection
  readonly type: string
  private readonly _options: SceneHistoryReplayOptions
  private _command: SceneCommand | null = null
  private _historyApplied = false
  private _signalsSynced = false
  private _sceneRevisionIncremented = false
  private _invalidated = false
  private _closed = false
  private _resuming = false

  constructor(options: SceneHistoryReplayOptions) {
    this.direction = options.direction
    this.type = `scene-history-${options.direction}`
    this._options = options
  }

  resume(): boolean {
    if (this._closed || this._resuming) return false
    this._resuming = true
    try {
      if (!this._historyApplied) {
        const apply = (command: SceneCommand): void => {
          this._command = command
          this._options.applyPatch(this.direction === 'undo' ? command.before : command.after)
        }
        const applied = this.direction === 'undo'
          ? this._options.history.undo(apply, this)
          : this._options.history.redo(apply, this)
        if (!applied) {
          this._close()
          return false
        }
        this._historyApplied = true
      }

      const command = this._command
      if (!command) throw new Error(`Scene history ${this.direction} completed without a command`)
      if (!this._signalsSynced) {
        this._options.syncCanvasSignalsFromScene()
        this._signalsSynced = true
      }
      if (!this._sceneRevisionIncremented) {
        this._sceneRevisionIncremented = true
        this._options.incrementSceneRevision()
      }
      if (!this._invalidated) {
        this._options.invalidate('scene')
        this._invalidated = true
      }
      this._close()
      return true
    } finally {
      this._resuming = false
    }
  }

  private _close(): void {
    this._closed = true
    this._options.release(this)
  }
}

interface SceneHydrationSettlementOptions {
  readonly type: 'document-hydration' | 'document-replacement'
  readonly token?: CanvasDocumentReplacementToken
  readonly file: CanopiFile
  readonly sceneStore: SceneStore
  readonly history: SceneHistory
  readonly noteStoreHydrated: () => void
  readonly syncDocumentSignals: () => void
  readonly syncCanvasSignalsFromScene: () => void
  readonly invalidate: (kind: SceneEditInvalidationKind) => void
  readonly incrementSceneRevision: () => void
  readonly finalizeReplacement?: () => void
  readonly release: (hydration: SceneHydrationSettlement) => void
}

class SceneHydrationSettlement implements SceneAuthorityOperation {
  readonly type: SceneHydrationSettlementOptions['type']
  private readonly _options: SceneHydrationSettlementOptions
  private readonly _fileKey: string
  private readonly _token: CanvasDocumentReplacementToken | undefined
  private _storeHydrated = false
  private _historyCleared = false
  private _documentSignalsSynced = false
  private _sceneSignalsSynced = false
  private _invalidated = false
  private _sceneRevisionIncremented = false
  private _replacementFinalized = false
  private _hydrationStarted = false
  private _closed = false
  private _resuming = false

  constructor(options: SceneHydrationSettlementOptions) {
    this._options = options
    this.type = options.type
    this._fileKey = stableDocumentKey(options.file)
    this._token = options.token
  }

  get canRetry(): boolean {
    return this._hydrationStarted && !this._resuming && !this._closed
  }

  matches(
    file: CanopiFile,
    type: SceneHydrationSettlementOptions['type'],
    token?: CanvasDocumentReplacementToken,
  ): boolean {
    return this.type === type
      && this._token === token
      && this._fileKey === stableDocumentKey(file)
  }

  beginHydration(): void {
    if (this._hydrationStarted) throw new Error(`${this.type} already started`)
    this._hydrationStarted = true
    this.resume()
  }

  resume(): void {
    if (!this._hydrationStarted) throw new SceneEditBusyError(this.type)
    if (this._closed || this._resuming) return
    this._resuming = true
    try {
      if (!this._storeHydrated) {
        this._options.sceneStore.hydrate(this._options.file)
        this._storeHydrated = true
        this._options.noteStoreHydrated()
      }
      if (!this._historyCleared) {
        this._options.history.clear()
        this._historyCleared = true
      }
      if (!this._documentSignalsSynced) {
        this._options.syncDocumentSignals()
        this._documentSignalsSynced = true
      }
      if (!this._sceneSignalsSynced) {
        this._options.syncCanvasSignalsFromScene()
        this._sceneSignalsSynced = true
      }
      if (!this._invalidated) {
        this._options.invalidate('scene')
        this._invalidated = true
      }
      if (!this._sceneRevisionIncremented) {
        this._sceneRevisionIncremented = true
        this._options.incrementSceneRevision()
      }
      if (!this._replacementFinalized) {
        this._options.finalizeReplacement?.()
        this._replacementFinalized = true
      }
      this._closed = true
      this._options.release(this)
    } finally {
      this._resuming = false
    }
  }
}

interface SceneRuntimeEditTransactionOptions {
  type: string
  sceneStore: SceneStore
  captureSnapshot(): SceneCommandSnapshot
  setSelection(targets: Iterable<SceneDesignObjectTarget>): void
  recordHistory(command: SceneCommand, token: object): void
  wasHistoryRecorded(token: object): boolean
  syncCanvasSignalsFromScene(): void
  incrementSceneRevision(): void
  invalidate(kind: SceneEditInvalidationKind): void
  onCommitted(): void
  restore(snapshot: SceneCommandSnapshot): void
  release(transaction: SceneRuntimeEditTransaction): void
}

type SceneTransactionPhase = 'open' | 'committing' | 'aborting' | 'closed'
type SceneTransactionOutcome = 'committed' | 'aborted'

class SceneRuntimeEditTransaction implements SceneEditTransaction {
  private readonly _type: string
  private readonly _sceneStore: SceneStore
  private readonly _before: SceneCommandSnapshot
  private readonly _options: SceneRuntimeEditTransactionOptions
  private _phase: SceneTransactionPhase = 'open'
  private _command: SceneCommand | null | undefined
  private _historyAccepted = false
  private _historyPublished = false
  private _restored = false
  private _signalsSynced = false
  private _sceneRevisionIncremented = false
  private _invalidated = false
  private _committedContinuationSettled = false
  private _committedChanged = false
  private _outcome: SceneTransactionOutcome | null = null
  private _invalidationKind: SceneEditInvalidationKind = 'scene'
  private _settling = false

  constructor(options: SceneRuntimeEditTransactionOptions) {
    this._type = options.type
    this._sceneStore = options.sceneStore
    this._options = options
    this._before = options.captureSnapshot()
  }

  get type(): string {
    return this._type
  }

  get changed(): boolean {
    if (this._phase === 'closed') return this._committedChanged
    return this._createCommand(this._type) !== null
  }

  get committedChanged(): boolean {
    return this._committedChanged
  }

  get outcome(): SceneTransactionOutcome | null {
    return this._outcome
  }

  get isCommitting(): boolean {
    return this._phase === 'committing'
  }

  captureCommittedPersistedState(): ScenePersistedState {
    return cloneScenePersistedState(this._before.persisted)
  }

  mutate(edit: (draft: ScenePersistedState) => void): void {
    this._assertMutable()
    this._sceneStore.updatePersisted(edit)
  }

  setSelection(targets: Iterable<SceneDesignObjectTarget>): void {
    this._assertMutable()
    this._options.setSelection(targets)
  }

  commit(options: { type?: string; invalidate?: SceneEditInvalidationKind } = {}): boolean {
    if (this._phase === 'closed') return this._committedChanged
    if (this._phase === 'aborting') {
      this._resumeAbort()
      return false
    }
    if (this._phase === 'open') {
      const command = this._createCommand(options.type ?? this._type)
      this._phase = 'committing'
      this._command = command
      this._committedChanged = this._command !== null
      this._invalidationKind = options.invalidate ?? 'scene'
    }
    this._resumeCommit()
    return this._committedChanged
  }

  abort(): void {
    if (this._phase === 'closed') return
    if (this._phase === 'committing') {
      if (!this._historyAccepted && this._command) {
        this._phase = 'aborting'
        this._resumeAbort()
        return
      }
      this._resumeCommit()
      return
    }
    if (this._phase === 'open') this._phase = 'aborting'
    this._resumeAbort()
  }

  private _resumeCommit(): void {
    if (this._settling) return
    this._settling = true
    try {
      const command = this._command
      if (command) {
        if (!this._historyPublished) {
          try {
            this._options.recordHistory(command, this)
            this._historyAccepted = true
            this._historyPublished = true
          } catch (error) {
            this._historyAccepted = this._options.wasHistoryRecorded(this)
            throw error
          }
        }
        if (!this._signalsSynced) {
          this._options.syncCanvasSignalsFromScene()
          this._signalsSynced = true
        }
        if (!this._sceneRevisionIncremented) {
          this._sceneRevisionIncremented = true
          this._options.incrementSceneRevision()
        }
        if (!this._invalidated) {
          this._options.invalidate(this._invalidationKind)
          this._invalidated = true
        }
      }
      if (command && !this._committedContinuationSettled) {
        this._options.onCommitted()
        this._committedContinuationSettled = true
      }
      this._outcome = 'committed'
      this._close()
    } finally {
      this._settling = false
    }
  }

  private _resumeAbort(): void {
    if (this._settling) return
    this._settling = true
    try {
      if (!this._restored) {
        this._options.restore(this._before)
        this._restored = true
      }
      if (!this._signalsSynced) {
        this._options.syncCanvasSignalsFromScene()
        this._signalsSynced = true
      }
      this._outcome = 'aborted'
      this._close()
    } finally {
      this._settling = false
    }
  }

  private _createCommand(type: string): SceneCommand | null {
    return createScenePatchCommand(type, this._before, this._options.captureSnapshot())
  }

  private _assertMutable(): void {
    if (this._phase !== 'open') throw new Error('Scene edit transaction is finalizing or closed')
  }

  private _close(): void {
    this._phase = 'closed'
    this._options.release(this)
  }
}

function stableDocumentKey(file: CanopiFile): string {
  return JSON.stringify(file, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right)),
    )
  })
}

function cloneDocument(file: CanopiFile): CanopiFile {
  return JSON.parse(JSON.stringify(file)) as CanopiFile
}
