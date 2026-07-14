import { computed, signal, type ReadonlySignal } from '@preact/signals'

import type { CanopiFile } from '../../../types/design'
import { throwCanvasRuntimeCleanupErrors } from '../cleanup'
import type { CanvasDocumentReplacementToken } from '../runtime'
import type { SceneHistory } from '../scene-history'
import type { ScenePersistedState, ScenePlantEntity, SceneStore } from '../scene'
import {
  applySceneCommandPersistedPatch,
  createScenePatchCommand,
  type SceneCommand,
  type SceneCommandPatch,
  type SceneCommandSnapshot,
} from '../scene-commands'
import type { PlantPresentationBackfill } from './presentation'

export type SceneEditInvalidationKind = 'scene' | 'viewport' | 'chrome'

export interface SceneEditTransaction {
  mutate(edit: (draft: ScenePersistedState) => void): void
  setSelection(ids: Iterable<string>): void
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

export interface SceneSavedCheckpoint {
  markSaved(): void
}

export type SettledSceneHistory = SceneHistoryCommands & SceneSavedCheckpoint

declare const scenePresentationTicketBrand: unique symbol

export interface ScenePresentationTicket {
  readonly [scenePresentationTicketBrand]: true
}

export type SceneBackfillResult = 'applied' | 'unchanged' | 'deferred' | 'stale'

export interface ScenePresentationMaintenance {
  issueTicket(): ScenePresentationTicket
  applyBackfills(
    ticket: ScenePresentationTicket,
    backfills: readonly PlantPresentationBackfill[] | null,
  ): SceneBackfillResult
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

export type SceneRuntimeAuthority = SceneEditCoordinator
  & SceneCommandAdmission
  & SettledSceneReader
  & SettledSceneHistory
  & ScenePresentationMaintenance
  & SceneDocumentAuthority

export class SceneEditBusyError extends Error {
  constructor(readonly activeType: string) {
    super(`Scene edit ${activeType} already owns the Scene`)
    this.name = 'SceneEditBusyError'
  }
}

interface SceneRuntimeEditCoordinatorOptions {
  sceneStore: SceneStore
  history: SceneHistory
  setSelection(ids: Iterable<string>): void
  incrementSceneRevision(): void
  incrementViewportRevision?(): void
  syncCanvasSignalsFromScene(): void
  invalidate(kind: SceneEditInvalidationKind): void
}

interface PresentationTicketState {
  readonly generation: number
  readonly contentRevision: number
  readonly plantLineage: ReadonlyMap<
    string,
    { readonly canonicalName: string; readonly presentationVersion: number }
  >
}

interface DeferredBackfill {
  readonly ticket: PresentationTicketState
  readonly backfill: PlantPresentationBackfill
}

type MaintainedPlantPresentation = Pick<
  ScenePlantEntity,
  'canonicalName' | 'stratum' | 'canopySpreadM' | 'scale'
>

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
  private readonly _incrementViewportRevision: () => void
  private readonly _syncCanvasSignalsFromScene: SceneRuntimeEditCoordinatorOptions['syncCanvasSignalsFromScene']
  private readonly _invalidate: SceneRuntimeEditCoordinatorOptions['invalidate']
  private readonly _admissionRevision = signal(0)
  private readonly _tickets = new WeakMap<ScenePresentationTicket, PresentationTicketState>()
  private readonly _deferredBackfills = new Map<string, DeferredBackfill>()
  private readonly _plantPresentationVersions = new Map<string, number>()
  private readonly _maintainedPlantPresentations = new Map<
    string,
    MaintainedPlantPresentation
  >()
  private _active: SceneAuthorityOperation | null = null
  private _replacementHandoff: {
    readonly predecessor: SceneRuntimeEditTransaction
    readonly successor: SceneHydrationSettlement
  } | null = null
  private _pendingImmediate: PendingImmediateEdit | null = null
  private _documentGeneration = 0
  private _contentRevision = 0
  private _backfillRevisionPending = false
  private _backfillInvalidationPending = false
  private _publishingBackfill = false
  private _drainingDeferredBackfills = false

  readonly revision: ReadonlySignal<number> = this._admissionRevision
  readonly canUndo = computed(() => {
    void this._admissionRevision.value
    return this._active === null
      && !this._isPresentationMaintenanceBusy()
      && this._history.canUndo.value
  })
  readonly canRedo = computed(() => {
    void this._admissionRevision.value
    return this._active === null
      && !this._isPresentationMaintenanceBusy()
      && this._history.canRedo.value
  })

  constructor(options: SceneRuntimeEditCoordinatorOptions) {
    this._sceneStore = options.sceneStore
    this._history = options.history
    this._setSelection = options.setSelection
    this._incrementSceneRevision = options.incrementSceneRevision
    this._incrementViewportRevision = options.incrementViewportRevision ?? (() => {})
    this._syncCanvasSignalsFromScene = options.syncCanvasSignalsFromScene
    this._invalidate = options.invalidate
  }

  runWhenSettled<T>(
    operation: () => T,
    busyResult: T,
    options: { resumePending?: boolean } = {},
  ): T {
    if (this._isPresentationMaintenanceExecuting()) return busyResult
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
    this._flushBackfillPublication()
    if (this._active || this._isPresentationMaintenanceBusy()) return busyResult
    return operation()
  }

  readWhenSettled<T>(operation: () => T, busyResult: T): T {
    if (this._active || this._isPresentationMaintenanceBusy()) return busyResult
    return operation()
  }

  run(
    type: string,
    edit: (tx: SceneEditTransaction) => void,
    options: SceneEditRunOptions = {},
  ): boolean {
    if (this._isPresentationMaintenanceExecuting()) return false
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
    if (this._isPresentationMaintenanceExecuting()) {
      throw new SceneEditBusyError('presentation-backfill')
    }
    if (this._active) throw new SceneEditBusyError(this._active.type)
    this._flushBackfillPublication()
    const reentrantActiveType = this._activeOperationType()
    if (reentrantActiveType) throw new SceneEditBusyError(reentrantActiveType)
    if (this._isPresentationMaintenanceBusy()) {
      throw new SceneEditBusyError('presentation-backfill')
    }
    const transaction = new SceneRuntimeEditTransaction({
      type,
      sceneStore: this._sceneStore,
      captureSnapshot: () => this._captureSnapshot(),
      setSelection: this._setSelection,
      recordHistory: (command, token) => {
        this._history.record(command, token)
      },
      wasHistoryRecorded: (token) => this._history.hasRecorded(token),
      noteCommitted: (command) => this._noteCommitted(command),
      incrementDocumentRevision: () => {
        this._sceneStore.updateSession((session) => {
          session.documentRevision += 1
        })
      },
      syncCanvasSignalsFromScene: this._syncCanvasSignalsFromScene,
      incrementSceneRevision: this._incrementSceneRevision,
      invalidate: this._invalidate,
      onCommitted,
      restore: (snapshot) => this._restore(snapshot),
      settleWithoutContentChange: () => this._drainDeferredBackfills(),
      release: (settled) => this._release(settled),
    })
    this._acquire(transaction)
    return transaction
  }

  undo(): boolean {
    if (this._isPresentationMaintenanceExecuting()) return false
    if (this._active) {
      return this._active instanceof SceneHistoryReplay
        && this._active.direction === 'undo'
        ? this._active.resume()
        : false
    }
    this._flushBackfillPublication()
    if (this._active || this._isPresentationMaintenanceBusy()) return false
    if (!this._history.canUndo.value) return false
    const replay = this._createHistoryReplay('undo')
    this._acquire(replay)
    return replay.resume()
  }

  redo(): boolean {
    if (this._isPresentationMaintenanceExecuting()) return false
    if (this._active) {
      return this._active instanceof SceneHistoryReplay
        && this._active.direction === 'redo'
        ? this._active.resume()
        : false
    }
    this._flushBackfillPublication()
    if (this._active || this._isPresentationMaintenanceBusy()) return false
    if (!this._history.canRedo.value) return false
    const replay = this._createHistoryReplay('redo')
    this._acquire(replay)
    return replay.resume()
  }

  markSaved(): void {
    this.runWhenSettled(() => this._history.markSaved(), undefined, { resumePending: true })
  }

  issueTicket(): ScenePresentationTicket {
    const ticket = Object.freeze({}) as ScenePresentationTicket
    this._tickets.set(ticket, {
      generation: this._documentGeneration,
      contentRevision: this._contentRevision,
      plantLineage: new Map(
        this._sceneStore.persisted.plants.map((plant) => [
          plant.id,
          {
            canonicalName: plant.canonicalName,
            presentationVersion: this._plantPresentationVersions.get(plant.id) ?? 0,
          },
        ]),
      ),
    })
    return ticket
  }

  applyBackfills(
    ticket: ScenePresentationTicket,
    backfills: readonly PlantPresentationBackfill[] | null,
  ): SceneBackfillResult {
    this._flushBackfillPublication()
    const ticketState = this._tickets.get(ticket)
    if (!ticketState || !this._isTicketCurrent(ticketState)) return 'stale'
    if (!backfills || backfills.length === 0) return 'unchanged'
    let currentBackfills = backfills.filter((backfill) =>
      this._isBackfillCurrent(ticketState, backfill))
    if (currentBackfills.length === 0) return 'stale'
    if (this._active || this._isPresentationMaintenanceBusy()) {
      currentBackfills = currentBackfills.filter((backfill) => {
        const reserved = this._deferredBackfills.get(
          plantPresentationIdentityKey(backfill.plantId, backfill.canonicalName),
        )
        return !reserved || reserved.ticket === ticketState
      })
      if (currentBackfills.length === 0) return 'stale'
      for (const backfill of currentBackfills) {
        this._deferredBackfills.set(
          plantPresentationIdentityKey(backfill.plantId, backfill.canonicalName),
          { ticket: ticketState, backfill },
        )
      }
      return 'deferred'
    }
    return this._applyBackfillsNow(currentBackfills) ? 'applied' : 'unchanged'
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
    if (this._isPresentationMaintenanceExecuting()) {
      throw new SceneEditBusyError('presentation-backfill')
    }
    if (this._active) throw new SceneEditBusyError(this._active.type)
    if (this._isPresentationMaintenanceBusy()) {
      this._flushBackfillPublication()
      throw new SceneEditBusyError('presentation-backfill')
    }
    const ownedFile = cloneDocument(file)
    const hydration = new SceneHydrationSettlement({
      type: 'document-hydration',
      file: ownedFile,
      sceneStore: this._sceneStore,
      history: this._history,
      noteStoreHydrated: () => this._noteStoreHydrated(),
      incrementViewportRevision: this._incrementViewportRevision,
      syncDocumentSignals: () => syncDocumentSignals(cloneDocument(ownedFile)),
      syncCanvasSignalsFromScene: this._syncCanvasSignalsFromScene,
      invalidate: this._invalidate,
      incrementSceneRevision: this._incrementSceneRevision,
      settleDeferredBackfills: () => this._drainDeferredBackfills(),
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
    if (this._isPresentationMaintenanceExecuting()) {
      throw new SceneEditBusyError('presentation-backfill')
    }
    if (this._isPresentationMaintenanceBusy()) {
      if (!this._active) this._flushBackfillPublication()
      throw new SceneEditBusyError('presentation-backfill')
    }

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
      incrementViewportRevision: this._incrementViewportRevision,
      syncDocumentSignals: () => {
        stages.syncDocumentSignals?.(cloneDocument(ownedFile))
      },
      syncCanvasSignalsFromScene: this._syncCanvasSignalsFromScene,
      invalidate: this._invalidate,
      incrementSceneRevision: this._incrementSceneRevision,
      settleDeferredBackfills: () => this._drainDeferredBackfills(),
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
    } catch (error) {
      this._cancelReplacementBeforeHydration(replacement)
      throw error
    }

    if (this._active !== replacement) {
      this._cancelReplacementBeforeHydration(replacement)
      throw new SceneEditBusyError(predecessor?.type ?? replacement.type)
    }
    replacement.beginHydration()
    return stages.finalizeReplacement !== undefined
  }

  private _captureSnapshot(): SceneCommandSnapshot {
    return {
      persisted: this._sceneStore.persisted,
      selectedEntityIds: this._sceneStore.session.selectedEntityIds,
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

  private _applyPatch(
    patch: SceneCommandPatch,
    options: { preservePlantPresentation?: boolean } = {},
  ): void {
    if (patch.persisted) {
      const currentPlants = options.preservePlantPresentation
        ? this._sceneStore.persisted.plants
        : null
      this._sceneStore.updatePersisted((draft) => {
        applySceneCommandPersistedPatch(draft, patch)
        if (patch.persisted?.plants && currentPlants) {
          draft.plants = preserveCurrentPlantPresentation(
            draft.plants,
            currentPlants,
            this._maintainedPlantPresentations,
          )
        }
      })
    }
    if (patch.selection) this._setSelection(patch.selection)
  }

  private _noteCommitted(command: SceneCommand): void {
    if (command.diffs.some((diff) => diff !== 'selection')) {
      this._contentRevision += 1
      this._dropStaleDeferredBackfills()
      return
    }
    this._drainDeferredBackfills()
  }

  private _noteHistoryChange(command: SceneCommand): void {
    if (command.diffs.some((diff) => diff !== 'selection')) {
      this._contentRevision += 1
      this._dropStaleDeferredBackfills()
      return
    }
    this._drainDeferredBackfills()
  }

  private _isTicketCurrent(ticket: PresentationTicketState): boolean {
    return ticket.generation === this._documentGeneration
      && ticket.contentRevision === this._contentRevision
  }

  private _isBackfillCurrent(
    ticket: PresentationTicketState,
    backfill: PlantPresentationBackfill,
  ): boolean {
    const lineage = ticket.plantLineage.get(backfill.plantId)
    return this._isTicketCurrent(ticket)
      && lineage?.canonicalName === backfill.canonicalName
      && lineage.presentationVersion
        === (this._plantPresentationVersions.get(backfill.plantId) ?? 0)
  }

  private _dropStaleDeferredBackfills(): void {
    for (const [identity, deferred] of this._deferredBackfills) {
      if (!this._isTicketCurrent(deferred.ticket)) this._deferredBackfills.delete(identity)
    }
  }

  private _drainDeferredBackfills(): void {
    if (this._drainingDeferredBackfills) return
    this._drainingDeferredBackfills = true
    try {
      this._flushBackfillPublication()
      while (this._deferredBackfills.size > 0) {
        const currentPlantIdentities = new Set(
          this._sceneStore.persisted.plants.map((plant) =>
            plantPresentationIdentityKey(plant.id, plant.canonicalName),
          ),
        )
        const current = [...this._deferredBackfills.values()]
          .filter((entry) => this._isBackfillCurrent(entry.ticket, entry.backfill))
          .filter((entry) => currentPlantIdentities.has(plantPresentationIdentityKey(
            entry.backfill.plantId,
            entry.backfill.canonicalName,
          )))
          .map((entry) => entry.backfill)
        this._deferredBackfills.clear()
        if (current.length > 0) this._applyBackfillsNow(current)
      }
    } finally {
      this._drainingDeferredBackfills = false
    }
  }

  private _applyBackfillsNow(backfills: readonly PlantPresentationBackfill[]): boolean {
    const byIdentity = new Map(backfills.map((entry) => [
      plantPresentationIdentityKey(entry.plantId, entry.canonicalName),
      entry,
    ]))
    const changedPlantIds = new Set<string>()
    this._sceneStore.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) => {
        const next = byIdentity.get(
          plantPresentationIdentityKey(plant.id, plant.canonicalName),
        )
        if (!next) return plant
        if (
          next.stratum === plant.stratum
          && next.canopySpreadM === plant.canopySpreadM
          && next.scale === plant.scale
        ) {
          return plant
        }
        changedPlantIds.add(plant.id)
        return {
          ...plant,
          stratum: next.stratum,
          canopySpreadM: next.canopySpreadM,
          scale: next.scale,
        }
      })
    })
    if (changedPlantIds.size === 0) return false
    const currentPlantsById = new Map(
      this._sceneStore.persisted.plants.map((plant) => [plant.id, plant]),
    )
    for (const plantId of changedPlantIds) {
      const plant = currentPlantsById.get(plantId)!
      const presentation = byIdentity.get(
        plantPresentationIdentityKey(plant.id, plant.canonicalName),
      )!
      this._plantPresentationVersions.set(
        plantId,
        (this._plantPresentationVersions.get(plantId) ?? 0) + 1,
      )
      this._maintainedPlantPresentations.set(
        plantPresentationIdentityKey(plantId, presentation.canonicalName),
        {
          canonicalName: presentation.canonicalName,
          stratum: presentation.stratum,
          canopySpreadM: presentation.canopySpreadM,
          scale: presentation.scale,
        },
      )
    }
    this._backfillRevisionPending = true
    this._backfillInvalidationPending = true
    this._flushBackfillPublication()
    return true
  }

  private _flushBackfillPublication(): void {
    if (this._publishingBackfill) return
    if (!this._backfillRevisionPending && !this._backfillInvalidationPending) return
    this._publishingBackfill = true
    this._publishAdmissionRevision()
    try {
      if (this._backfillRevisionPending) {
        this._backfillRevisionPending = false
        this._incrementSceneRevision()
      }
      if (this._backfillInvalidationPending) {
        this._invalidate('scene')
        this._backfillInvalidationPending = false
      }
    } finally {
      this._publishingBackfill = false
    }
    if (
      !this._active
      && !this._drainingDeferredBackfills
      && this._deferredBackfills.size > 0
    ) {
      this._drainDeferredBackfills()
    }
    if (!this._active && !this._isPresentationMaintenanceBusy()) {
      this._publishAdmissionRevision()
    }
  }

  private _createHistoryReplay(direction: SceneHistoryReplayDirection): SceneHistoryReplay {
    return new SceneHistoryReplay({
      direction,
      history: this._history,
      applyPatch: (patch) => this._applyPatch(patch, { preservePlantPresentation: true }),
      noteHistoryChange: (command) => this._noteHistoryChange(command),
      syncCanvasSignalsFromScene: this._syncCanvasSignalsFromScene,
      incrementSceneRevision: this._incrementSceneRevision,
      invalidate: this._invalidate,
      settleDeferredBackfills: () => this._drainDeferredBackfills(),
      release: (settled) => this._release(settled),
    })
  }

  private _noteStoreHydrated(): void {
    this._documentGeneration += 1
    this._contentRevision = 0
    this._deferredBackfills.clear()
    this._plantPresentationVersions.clear()
    this._maintainedPlantPresentations.clear()
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

  private _isPresentationMaintenanceBusy(): boolean {
    return this._isPresentationMaintenanceExecuting()
      || this._backfillRevisionPending
      || this._backfillInvalidationPending
  }

  private _isPresentationMaintenanceExecuting(): boolean {
    return this._publishingBackfill || this._drainingDeferredBackfills
  }

  private _activeOperationType(): string | null {
    return this._active?.type ?? null
  }
}

type SceneHistoryReplayDirection = 'undo' | 'redo'

interface SceneHistoryReplayOptions {
  readonly direction: SceneHistoryReplayDirection
  readonly history: SceneHistory
  readonly applyPatch: (patch: SceneCommandPatch) => void
  readonly noteHistoryChange: (command: SceneCommand) => void
  readonly syncCanvasSignalsFromScene: () => void
  readonly incrementSceneRevision: () => void
  readonly invalidate: (kind: SceneEditInvalidationKind) => void
  readonly settleDeferredBackfills: () => void
  readonly release: (replay: SceneHistoryReplay) => void
}

class SceneHistoryReplay implements SceneAuthorityOperation {
  readonly direction: SceneHistoryReplayDirection
  readonly type: string
  private readonly _options: SceneHistoryReplayOptions
  private _command: SceneCommand | null = null
  private _historyApplied = false
  private _contentNoted = false
  private _signalsSynced = false
  private _sceneRevisionIncremented = false
  private _invalidated = false
  private _deferredBackfillsSettled = false
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
      if (!this._contentNoted) {
        this._options.noteHistoryChange(command)
        this._contentNoted = true
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
        this._options.invalidate('scene')
        this._invalidated = true
      }
      if (!this._deferredBackfillsSettled) {
        this._options.settleDeferredBackfills()
        this._deferredBackfillsSettled = true
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
  readonly incrementViewportRevision: () => void
  readonly syncDocumentSignals: () => void
  readonly syncCanvasSignalsFromScene: () => void
  readonly invalidate: (kind: SceneEditInvalidationKind) => void
  readonly incrementSceneRevision: () => void
  readonly settleDeferredBackfills: () => void
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
  private _viewportRevisionIncremented = false
  private _documentSignalsSynced = false
  private _sceneSignalsSynced = false
  private _invalidated = false
  private _sceneRevisionIncremented = false
  private _deferredBackfillsSettled = false
  private _postFinalizerBackfillsSettled = false
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
      if (!this._viewportRevisionIncremented) {
        this._viewportRevisionIncremented = true
        this._options.incrementViewportRevision()
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
      if (!this._deferredBackfillsSettled) {
        this._options.settleDeferredBackfills()
        this._deferredBackfillsSettled = true
      }
      if (!this._replacementFinalized) {
        this._options.finalizeReplacement?.()
        this._replacementFinalized = true
      }
      if (!this._postFinalizerBackfillsSettled) {
        this._options.settleDeferredBackfills()
        this._postFinalizerBackfillsSettled = true
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
  setSelection(ids: Iterable<string>): void
  recordHistory(command: SceneCommand, token: object): void
  wasHistoryRecorded(token: object): boolean
  noteCommitted(command: SceneCommand): void
  incrementDocumentRevision(): void
  syncCanvasSignalsFromScene(): void
  incrementSceneRevision(): void
  invalidate(kind: SceneEditInvalidationKind): void
  onCommitted(): void
  restore(snapshot: SceneCommandSnapshot): void
  settleWithoutContentChange(): void
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
  private _documentRevisionIncremented = false
  private _outcomeRecorded = false
  private _signalsSynced = false
  private _sceneRevisionIncremented = false
  private _invalidated = false
  private _deferredSettled = false
  private _committedContinuationSettled = false
  private _postContinuationDeferredSettled = false
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

  mutate(edit: (draft: ScenePersistedState) => void): void {
    this._assertMutable()
    this._sceneStore.updatePersisted(edit)
  }

  setSelection(ids: Iterable<string>): void {
    this._assertMutable()
    this._options.setSelection(ids)
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
      if (!this._historyAccepted && !this._outcomeRecorded && this._command) {
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
        if (!this._documentRevisionIncremented) {
          this._options.incrementDocumentRevision()
          this._documentRevisionIncremented = true
        }
        if (!this._outcomeRecorded) {
          this._options.noteCommitted(command)
          this._outcomeRecorded = true
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
      if (!this._deferredSettled) {
        this._options.settleWithoutContentChange()
        this._deferredSettled = true
      }
      if (command && !this._committedContinuationSettled) {
        this._options.onCommitted()
        this._committedContinuationSettled = true
      }
      if (!this._postContinuationDeferredSettled) {
        this._options.settleWithoutContentChange()
        this._postContinuationDeferredSettled = true
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
      if (!this._outcomeRecorded) {
        this._options.restore(this._before)
        this._outcomeRecorded = true
      }
      if (!this._signalsSynced) {
        this._options.syncCanvasSignalsFromScene()
        this._signalsSynced = true
      }
      if (!this._deferredSettled) {
        this._options.settleWithoutContentChange()
        this._deferredSettled = true
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

function plantPresentationIdentityKey(plantId: string, canonicalName: string): string {
  return `${plantId}\u0000${canonicalName}`
}

function preserveCurrentPlantPresentation(
  patchedPlants: readonly ScenePlantEntity[],
  currentPlants: readonly ScenePlantEntity[],
  maintainedPresentations: ReadonlyMap<string, MaintainedPlantPresentation>,
): ScenePlantEntity[] {
  const currentById = new Map(currentPlants.map((plant) => [plant.id, plant]))
  return patchedPlants.map((plant) => {
    const current = currentById.get(plant.id)
    const maintained = maintainedPresentations.get(
      plantPresentationIdentityKey(plant.id, plant.canonicalName),
    )
    const presentation = current?.canonicalName === plant.canonicalName
      ? current
      : maintained?.canonicalName === plant.canonicalName
        ? maintained
        : null
    if (!presentation) return plant
    return {
      ...plant,
      stratum: presentation.stratum,
      canopySpreadM: presentation.canopySpreadM,
      scale: presentation.scale,
    }
  })
}
