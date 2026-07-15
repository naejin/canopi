import { batch, computed, signal, type ReadonlySignal, type Signal } from '@preact/signals'
import type { CanopiFile } from '../../types/design'
import {
  DesignEditBusyError,
  DesignEditUnavailableError,
  registerDesignEditAuthorityCapability,
  type DesignPreviewOutcome,
  type DesignPreviewTransaction,
  type DesignProjector,
} from '../design-edit/authority-capability'
import {
  registerDesignSessionPersistenceCapability,
  type DesignSessionPersistenceCapture,
} from './persistence-capability'

export interface PendingTemplateImport {
  readonly path: string
  readonly name: string
}

export interface DesignSessionIdentity {
  readonly file: CanopiFile | null
  readonly path: string | null
  readonly name: string
}

export interface DesignSessionMetadataSnapshot {
  readonly northBearingDeg: number | null
}

export interface DesignSessionStore {
  readonly currentDesign: ReadonlySignal<CanopiFile | null>
  readonly designPath: ReadonlySignal<string | null>
  readonly designName: ReadonlySignal<string>
  readonly designDirty: ReadonlySignal<boolean>
  readonly canvasDirty: ReadonlySignal<boolean>
  readonly autosaveFailed: ReadonlySignal<boolean>
  readonly committedDesignRevision: ReadonlySignal<number>

  readIdentity(): DesignSessionIdentity
  readMetadata(): DesignSessionMetadataSnapshot
  readCurrentDesign(): CanopiFile | null
  readDesignPath(): string | null
  readDesignName(): string
  hasCurrentDesign(): boolean
  isDesignDirty(): boolean
  isCanvasDirty(): boolean

  replaceCurrentDesignState(file: CanopiFile, path: string | null, name: string): void
  replaceCurrentDesignSnapshot(file: CanopiFile): void
  renameCurrentDesign(name: string): boolean

  resetDirtyBaselines(): void
  markCanvasDetachedDirty(dirty: boolean): void
  setCanvasClean(clean: boolean): void
  setAutosaveFailed(failed: boolean): void

  readPendingDesignPath(): string | null
  setPendingDesignPath(path: string | null): void
  readPendingTemplateImport(): PendingTemplateImport | null
  setPendingTemplateImport(template: PendingTemplateImport | null): void
}

declare const persistenceCapableDesignSessionStoreBrand: unique symbol

export interface PersistenceCapableDesignSessionStore extends DesignSessionStore {
  readonly [persistenceCapableDesignSessionStoreBrand]: true
}

interface DesignSessionStoreSignals {
  readonly currentDesign: Signal<CanopiFile | null>
  readonly designPath: Signal<string | null>
  readonly designName: Signal<string>
  readonly nonCanvasRevision: Signal<number>
  readonly nonCanvasSavedRevision: Signal<number>
  readonly persistenceDiverged: Signal<boolean>
  readonly autosaveFailed: Signal<boolean>
  readonly canvasClean: Signal<boolean>
  readonly detachedCanvasDirty: Signal<boolean>
  readonly pendingDesignPath: Signal<string | null>
  readonly pendingTemplateImport: Signal<PendingTemplateImport | null>
  readonly canvasDirty: ReadonlySignal<boolean>
  readonly designDirty: ReadonlySignal<boolean>
}

export interface DesignSessionStoreTestState extends Partial<DesignSessionIdentity> {
  readonly nonCanvasRevision?: number
  readonly nonCanvasSavedRevision?: number
  readonly persistenceDiverged?: boolean
  readonly autosaveFailed?: boolean
  readonly canvasClean?: boolean
  readonly detachedCanvasDirty?: boolean
  readonly pendingDesignPath?: string | null
  readonly pendingTemplateImport?: PendingTemplateImport | null
}

export interface DesignSessionStoreTestFixture {
  readonly nonCanvasRevision: ReadonlySignal<number>
  readonly nonCanvasSavedRevision: ReadonlySignal<number>
  readonly persistenceDiverged: ReadonlySignal<boolean>
  readonly canvasClean: ReadonlySignal<boolean>
  readonly detachedCanvasDirty: ReadonlySignal<boolean>
  readonly pendingDesignPath: ReadonlySignal<string | null>
  readonly pendingTemplateImport: ReadonlySignal<PendingTemplateImport | null>
  reset(initial?: DesignSessionStoreTestState): void
  setState(state: DesignSessionStoreTestState): void
  markSaved(): void
}

const testFixtures = new WeakMap<object, DesignSessionStoreTestFixture>()

function createDesignSessionStore(
  initial: Partial<DesignSessionIdentity> = {},
): PersistenceCapableDesignSessionStore {
  const currentDesign = signal<CanopiFile | null>(initial.file ?? null)
  const designPath = signal<string | null>(initial.path ?? null)
  const designName = signal<string>(initial.name ?? initial.file?.name ?? 'Untitled')
  const nonCanvasRevision = signal(0)
  const nonCanvasSavedRevision = signal(0)
  const persistenceDiverged = signal(false)
  const autosaveFailed = signal(false)
  const canvasClean = signal(true)
  const detachedCanvasDirty = signal(false)
  const pendingDesignPath = signal<string | null>(null)
  const pendingTemplateImport = signal<PendingTemplateImport | null>(null)
  const canvasDirty = computed(() => detachedCanvasDirty.value || !canvasClean.value)
  const designDirty = computed(() =>
    canvasDirty.value
    || nonCanvasRevision.value !== nonCanvasSavedRevision.value
    || persistenceDiverged.value
  )
  const signals: DesignSessionStoreSignals = {
    currentDesign,
    designPath,
    designName,
    nonCanvasRevision,
    nonCanvasSavedRevision,
    persistenceDiverged,
    autosaveFailed,
    canvasClean,
    detachedCanvasDirty,
    pendingDesignPath,
    pendingTemplateImport,
    canvasDirty,
    designDirty,
  }

  let lifetime = Object.freeze({})
  let sessionGeneration = 0
  let detachedCanvasRevision = 0
  let committedContentRevision = 0
  let previewGeneration = 0
  let acknowledgementGeneration = 0
  let committedDesign = signals.currentDesign.value
  const committedDesignRevision = signal(0)
  let activePreview: {
    readonly identity: object
    readonly intent: string
    projector: DesignProjector | null
    mutated: boolean
  } | null = null

  function invalidateActivePreview(): void {
    if (activePreview) previewGeneration += 1
    activePreview = null
  }

  function visibleProjectionFor(file: CanopiFile): CanopiFile {
    return activePreview?.projector?.(file) ?? file
  }

  function applyCommittedDesign(
    updater: (design: CanopiFile) => CanopiFile,
    markDirty: boolean,
  ): CanopiFile | null {
    const current = committedDesign
    if (!current) return null

    const next = updater(current)
    if (next === current) return current
    const visible = visibleProjectionFor(next)

    committedDesign = next
    committedContentRevision += 1
    if (activePreview) activePreview.mutated = visible !== next
    batch(() => {
      signals.currentDesign.value = visible
      committedDesignRevision.value += 1
      if (markDirty) {
        signals.nonCanvasRevision.value += 1
      }
    })
    return next
  }

  function beginPreview(intent: string): DesignPreviewTransaction {
    const current = committedDesign
    if (!current) throw new DesignEditUnavailableError()
    if (activePreview) throw new DesignEditBusyError(activePreview.intent)

    const identity = Object.freeze({})
    let outcome: DesignPreviewOutcome | null = null
    activePreview = {
      identity,
      intent,
      projector: null,
      mutated: false,
    }
    previewGeneration += 1

    const isCurrent = () => activePreview?.identity === identity
    const superseded = (): DesignPreviewOutcome => {
      outcome ??= Object.freeze({ status: 'superseded' })
      return outcome
    }

    return Object.freeze({
      get hasMutated() {
        return isCurrent() ? activePreview!.mutated : outcome?.status === 'committed'
          ? outcome.changed
          : false
      },
      preview(projector: DesignProjector) {
        if (!isCurrent()) return
        const next = projector(committedDesign!)
        const mutated = next !== committedDesign
        activePreview!.projector = projector
        activePreview!.mutated = mutated
        previewGeneration += 1
        signals.currentDesign.value = next
      },
      commit(): DesignPreviewOutcome {
        if (outcome) return outcome
        if (!isCurrent()) return superseded()
        const next = activePreview!.projector?.(committedDesign!) ?? committedDesign!
        const changed = next !== committedDesign
        activePreview = null
        previewGeneration += 1
        if (changed) {
          committedDesign = next
          committedContentRevision += 1
        }
        outcome = Object.freeze({ status: 'committed', changed })
        batch(() => {
          signals.currentDesign.value = committedDesign
          if (changed) committedDesignRevision.value += 1
          if (changed) signals.nonCanvasRevision.value += 1
        })
        return outcome
      },
      abort(): DesignPreviewOutcome {
        if (outcome) return outcome
        if (!isCurrent()) return superseded()
        activePreview = null
        previewGeneration += 1
        outcome = Object.freeze({ status: 'aborted' })
        signals.currentDesign.value = committedDesign
        return outcome
      },
    })
  }

  function rolloverDesignEditAuthority(): void {
    sessionGeneration += 1
    previewGeneration += 1
    activePreview = null
    signals.currentDesign.value = committedDesign
  }

  const store = {
    currentDesign: signals.currentDesign,
    designPath: signals.designPath,
    designName: signals.designName,
    designDirty: signals.designDirty,
    canvasDirty: signals.canvasDirty,
    autosaveFailed: signals.autosaveFailed,
    committedDesignRevision,

    readIdentity() {
      return {
        file: signals.currentDesign.value,
        path: signals.designPath.value,
        name: signals.designName.value,
      }
    },

    readMetadata() {
      return {
        northBearingDeg: signals.currentDesign.value?.north_bearing_deg ?? null,
      }
    },

    readCurrentDesign() {
      return signals.currentDesign.value
    },

    readDesignPath() {
      return signals.designPath.value
    },

    readDesignName() {
      return signals.designName.value
    },

    hasCurrentDesign() {
      return signals.currentDesign.value !== null
    },

    isDesignDirty() {
      return signals.designDirty.value
    },

    isCanvasDirty() {
      return signals.canvasDirty.value
    },

    replaceCurrentDesignState(file, path, name) {
      sessionGeneration += 1
      detachedCanvasRevision = 0
      committedContentRevision += 1
      invalidateActivePreview()
      committedDesign = file
      batch(() => {
        signals.currentDesign.value = file
        committedDesignRevision.value += 1
        signals.persistenceDiverged.value = false
        signals.designPath.value = path
        signals.designName.value = name
      })
    },

    replaceCurrentDesignSnapshot(file) {
      const visible = visibleProjectionFor(file)
      detachedCanvasRevision += 1
      committedContentRevision += 1
      committedDesign = file
      if (activePreview) activePreview.mutated = visible !== file
      batch(() => {
        signals.currentDesign.value = visible
        committedDesignRevision.value += 1
      })
    },

    renameCurrentDesign(name) {
      const design = committedDesign
      if (!design || name === signals.designName.value) return false
      const next = { ...design, name }
      const visible = visibleProjectionFor(next)
      committedDesign = next
      committedContentRevision += 1
      if (activePreview) activePreview.mutated = visible !== next
      batch(() => {
        signals.currentDesign.value = visible
        committedDesignRevision.value += 1
        signals.designName.value = name
        signals.nonCanvasRevision.value += 1
      })
      return true
    },

    resetDirtyBaselines() {
      batch(() => {
        signals.canvasClean.value = true
        signals.detachedCanvasDirty.value = false
        signals.nonCanvasRevision.value = 0
        signals.nonCanvasSavedRevision.value = 0
        signals.persistenceDiverged.value = false
        signals.autosaveFailed.value = false
      })
    },

    markCanvasDetachedDirty(dirty) {
      signals.detachedCanvasDirty.value = dirty
    },

    setCanvasClean(clean) {
      signals.canvasClean.value = clean
    },

    setAutosaveFailed(failed) {
      signals.autosaveFailed.value = failed
    },

    readPendingDesignPath() {
      return signals.pendingDesignPath.value
    },

    setPendingDesignPath(path) {
      signals.pendingDesignPath.value = path
    },

    readPendingTemplateImport() {
      return signals.pendingTemplateImport.value
    },

    setPendingTemplateImport(template) {
      signals.pendingTemplateImport.value = template
    },
  } as PersistenceCapableDesignSessionStore

  registerDesignEditAuthorityCapability(
    store,
    {
      editCommitted: (projector) => applyCommittedDesign(projector, true),
      reconcileCommitted: (projector) => applyCommittedDesign(projector, false),
      markCommittedDirty: () => {
        signals.nonCanvasRevision.value += 1
      },
      beginPreview,
    },
    rolloverDesignEditAuthority,
  )

  registerDesignSessionPersistenceCapability(store, () => {
    const capturedLifetime = lifetime
    const file = committedDesign
    const generation = sessionGeneration
    const canvasRevision = detachedCanvasRevision
    const contentRevision = committedContentRevision
    const capturedPreviewGeneration = previewGeneration
    const nonCanvasRevision = signals.nonCanvasRevision.value
    const persistenceDiverged = signals.persistenceDiverged.value
    // A guard captured while dirty may survive the exact Save that cleans it;
    // a guard captured clean must become stale if an older write later diverges.
    const divergenceBaselineIsCurrent = () =>
      persistenceDiverged || !signals.persistenceDiverged.value
    const capture: DesignSessionPersistenceCapture = {
      file: file ? cloneDocument(file) : null,
      path: signals.designPath.value,
      name: signals.designName.value,
      isCurrent: () => capturedLifetime === lifetime
        && generation === sessionGeneration
        && canvasRevision === detachedCanvasRevision,
      isExactCurrent: () => capturedLifetime === lifetime
        && generation === sessionGeneration
        && canvasRevision === detachedCanvasRevision
        && contentRevision === committedContentRevision
        && capturedPreviewGeneration === previewGeneration
        && nonCanvasRevision === signals.nonCanvasRevision.value
        && divergenceBaselineIsCurrent(),
      acknowledgeSaved(options = {}) {
        if (
          capturedLifetime !== lifetime
          || generation !== sessionGeneration
          || canvasRevision !== detachedCanvasRevision
        ) return 'stale'
        const acknowledgement = ++acknowledgementGeneration
        batch(() => {
          if (options.canvasAcknowledged || options.canvasDetached) {
            signals.detachedCanvasDirty.value = false
          }
          if (options.canvasDetached) signals.canvasClean.value = true
          signals.nonCanvasSavedRevision.value = nonCanvasRevision
          signals.persistenceDiverged.value = contentRevision !== committedContentRevision
          signals.autosaveFailed.value = false
        })
        if (
          acknowledgement === acknowledgementGeneration
          && capturedLifetime === lifetime
          && generation === sessionGeneration
          && canvasRevision === detachedCanvasRevision
          && contentRevision !== committedContentRevision
        ) {
          signals.persistenceDiverged.value = true
        }
        return 'applied'
      },
      updatePath(path) {
        if (
          capturedLifetime !== lifetime
          || generation !== sessionGeneration
          || canvasRevision !== detachedCanvasRevision
        ) return false
        signals.designPath.value = path
        return true
      },
      setAutosaveFailed(failed) {
        if (
          capturedLifetime !== lifetime
          || generation !== sessionGeneration
          || canvasRevision !== detachedCanvasRevision
        ) return false
        signals.autosaveFailed.value = failed
        return true
      },
    }
    return Object.freeze(capture)
  })

  const fixture = Object.freeze({
    nonCanvasRevision: signals.nonCanvasRevision,
    nonCanvasSavedRevision: signals.nonCanvasSavedRevision,
    persistenceDiverged: signals.persistenceDiverged,
    canvasClean: signals.canvasClean,
    detachedCanvasDirty: signals.detachedCanvasDirty,
    pendingDesignPath: signals.pendingDesignPath,
    pendingTemplateImport: signals.pendingTemplateImport,
    reset(state: DesignSessionStoreTestState = {}) {
      lifetime = Object.freeze({})
      sessionGeneration = 0
      detachedCanvasRevision = 0
      committedContentRevision = 0
      previewGeneration = 0
      acknowledgementGeneration = 0
      activePreview = null
      committedDesign = state.file ?? null
      batch(() => {
        signals.currentDesign.value = committedDesign
        signals.designPath.value = state.path ?? null
        signals.designName.value = state.name ?? state.file?.name ?? 'Untitled'
        signals.nonCanvasRevision.value = state.nonCanvasRevision ?? 0
        signals.nonCanvasSavedRevision.value = state.nonCanvasSavedRevision ?? 0
        signals.persistenceDiverged.value = state.persistenceDiverged ?? false
        signals.autosaveFailed.value = state.autosaveFailed ?? false
        signals.canvasClean.value = state.canvasClean ?? true
        signals.detachedCanvasDirty.value = state.detachedCanvasDirty ?? false
        signals.pendingDesignPath.value = state.pendingDesignPath ?? null
        signals.pendingTemplateImport.value = state.pendingTemplateImport ?? null
        committedDesignRevision.value = 0
      })
    },
    setState(state: DesignSessionStoreTestState) {
      const has = (property: keyof DesignSessionStoreTestState) =>
        Object.prototype.hasOwnProperty.call(state, property)
      if (has('file')) {
        sessionGeneration += 1
        detachedCanvasRevision = 0
        committedContentRevision += 1
        invalidateActivePreview()
        committedDesign = state.file ?? null
      }
      batch(() => {
        if (has('file')) {
          signals.currentDesign.value = committedDesign
          committedDesignRevision.value += 1
        }
        if (has('path')) signals.designPath.value = state.path ?? null
        if (has('name')) signals.designName.value = state.name ?? 'Untitled'
        if (has('nonCanvasRevision')) {
          signals.nonCanvasRevision.value = state.nonCanvasRevision ?? 0
        }
        if (has('nonCanvasSavedRevision')) {
          signals.nonCanvasSavedRevision.value = state.nonCanvasSavedRevision ?? 0
        }
        if (has('persistenceDiverged')) {
          signals.persistenceDiverged.value = state.persistenceDiverged ?? false
        }
        if (has('autosaveFailed')) {
          signals.autosaveFailed.value = state.autosaveFailed ?? false
        }
        if (has('canvasClean')) signals.canvasClean.value = state.canvasClean ?? true
        if (has('detachedCanvasDirty')) {
          signals.detachedCanvasDirty.value = state.detachedCanvasDirty ?? false
        }
        if (has('pendingDesignPath')) {
          signals.pendingDesignPath.value = state.pendingDesignPath ?? null
        }
        if (has('pendingTemplateImport')) {
          signals.pendingTemplateImport.value = state.pendingTemplateImport ?? null
        }
      })
    },
    markSaved() {
      acknowledgementGeneration += 1
      batch(() => {
        signals.detachedCanvasDirty.value = false
        signals.canvasClean.value = true
        signals.nonCanvasSavedRevision.value = signals.nonCanvasRevision.value
        signals.persistenceDiverged.value = false
        signals.autosaveFailed.value = false
      })
    },
  } satisfies DesignSessionStoreTestFixture)
  testFixtures.set(store, fixture)

  return store
}

export function createMemoryDesignSessionStore(
  initial: Partial<DesignSessionIdentity> = {},
): PersistenceCapableDesignSessionStore {
  return createDesignSessionStore(initial)
}

export function createDesignSessionStoreTestFixture(
  store: PersistenceCapableDesignSessionStore,
): DesignSessionStoreTestFixture {
  const fixture = testFixtures.get(store)
  if (!fixture) throw new Error('Design Session store has no test fixture capability')
  return fixture
}

export const designSessionStore: PersistenceCapableDesignSessionStore = createDesignSessionStore()

export const currentDesign = designSessionStore.currentDesign
export const designPath = designSessionStore.designPath
export const designName = designSessionStore.designName
export const designDirty = designSessionStore.designDirty
export const canvasDirty = designSessionStore.canvasDirty
export const autosaveFailed = designSessionStore.autosaveFailed

export const readCurrentDesign = () => designSessionStore.readCurrentDesign()
export const readDesignSessionMetadata = () => designSessionStore.readMetadata()
export const readDesignPath = () => designSessionStore.readDesignPath()
export const readDesignName = () => designSessionStore.readDesignName()
export const replaceCurrentDesignState = (
  file: CanopiFile,
  path: string | null,
  name: string,
) => designSessionStore.replaceCurrentDesignState(file, path, name)
export const replaceCurrentDesignSnapshot = (file: CanopiFile) =>
  designSessionStore.replaceCurrentDesignSnapshot(file)
export const resetDirtyBaselines = () => designSessionStore.resetDirtyBaselines()
export const markCanvasDetachedDirty = (dirty: boolean) =>
  designSessionStore.markCanvasDetachedDirty(dirty)
export const setCanvasClean = (clean: boolean) => designSessionStore.setCanvasClean(clean)
export const setAutosaveFailed = (failed: boolean) =>
  designSessionStore.setAutosaveFailed(failed)
export const setPendingDesignPath = (path: string | null) =>
  designSessionStore.setPendingDesignPath(path)
export const setPendingTemplateImport = (template: PendingTemplateImport | null) =>
  designSessionStore.setPendingTemplateImport(template)

function cloneDocument(file: CanopiFile): CanopiFile {
  return JSON.parse(JSON.stringify(file)) as CanopiFile
}
