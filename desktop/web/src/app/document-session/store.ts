import { batch, computed, signal, type ReadonlySignal, type Signal } from '@preact/signals'
import type { CanopiFile } from '../../types/design'
import * as designState from '../../state/design'
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

export interface DocumentMutationOptions {
  readonly markDirty?: boolean
}

export interface DesignSessionStore {
  readonly currentDesign: ReadonlySignal<CanopiFile | null>
  readonly designPath: ReadonlySignal<string | null>
  readonly designName: ReadonlySignal<string>
  readonly designDirty: ReadonlySignal<boolean>
  readonly canvasDirty: ReadonlySignal<boolean>
  readonly autosaveFailed: ReadonlySignal<boolean>

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
  mutateCurrentDesign(
    updater: (design: CanopiFile) => CanopiFile,
    options?: DocumentMutationOptions,
  ): CanopiFile | null
  markDocumentDirty(): void
  updateDesignArray<K extends keyof CanopiFile>(
    key: K,
    updater: (arr: CanopiFile[K]) => CanopiFile[K],
    options?: DocumentMutationOptions,
  ): void

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
  readonly autosaveFailed: Signal<boolean>
  readonly canvasClean: Signal<boolean>
  readonly detachedCanvasDirty: Signal<boolean>
  readonly pendingDesignPath: Signal<string | null>
  readonly pendingTemplateImport: Signal<PendingTemplateImport | null>
  readonly canvasDirty: ReadonlySignal<boolean>
  readonly designDirty: ReadonlySignal<boolean>
}

function createDesignSessionStore(
  signals: DesignSessionStoreSignals,
): PersistenceCapableDesignSessionStore {
  let sessionGeneration = 0
  let detachedCanvasRevision = 0

  const store = {
    currentDesign: signals.currentDesign,
    designPath: signals.designPath,
    designName: signals.designName,
    designDirty: signals.designDirty,
    canvasDirty: signals.canvasDirty,
    autosaveFailed: signals.autosaveFailed,

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
      batch(() => {
        signals.currentDesign.value = file
        signals.designPath.value = path
        signals.designName.value = name
      })
    },

    replaceCurrentDesignSnapshot(file) {
      detachedCanvasRevision += 1
      signals.currentDesign.value = file
    },

    renameCurrentDesign(name) {
      const design = signals.currentDesign.value
      if (!design || name === signals.designName.value) return false
      batch(() => {
        signals.currentDesign.value = { ...design, name }
        signals.designName.value = name
        signals.nonCanvasRevision.value += 1
      })
      return true
    },

    mutateCurrentDesign(updater, options = {}) {
      const design = signals.currentDesign.value
      if (!design) return null

      const next = updater(design)
      if (next === design) return design

      batch(() => {
        signals.currentDesign.value = next
        if (options.markDirty !== false) {
          signals.nonCanvasRevision.value += 1
        }
      })

      return next
    },

    markDocumentDirty() {
      signals.nonCanvasRevision.value += 1
    },

    updateDesignArray(key, updater, options = {}) {
      const design = signals.currentDesign.value
      if (!design) return

      const next = updater(design[key])
      if (next === design[key]) return

      batch(() => {
        signals.currentDesign.value = { ...design, [key]: next }
        if (options.markDirty !== false) {
          signals.nonCanvasRevision.value += 1
        }
      })
    },

    resetDirtyBaselines() {
      batch(() => {
        signals.canvasClean.value = true
        signals.detachedCanvasDirty.value = false
        signals.nonCanvasRevision.value = 0
        signals.nonCanvasSavedRevision.value = 0
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

  registerDesignSessionPersistenceCapability(store, () => {
    const file = signals.currentDesign.value
    if (!file) throw new Error('Cannot capture persistence state without a loaded Design')
    const generation = sessionGeneration
    const canvasRevision = detachedCanvasRevision
    const nonCanvasRevision = signals.nonCanvasRevision.value
    const capture: DesignSessionPersistenceCapture = {
      file: cloneDocument(file),
      path: signals.designPath.value,
      name: signals.designName.value,
      isCurrent: () => generation === sessionGeneration
        && canvasRevision === detachedCanvasRevision,
      isExactCurrent: () => generation === sessionGeneration
        && canvasRevision === detachedCanvasRevision
        && nonCanvasRevision === signals.nonCanvasRevision.value,
      acknowledgeSaved(options = {}) {
        if (
          generation !== sessionGeneration
          || canvasRevision !== detachedCanvasRevision
        ) return 'stale'
        batch(() => {
          if (options.canvasAcknowledged || options.canvasDetached) {
            signals.detachedCanvasDirty.value = false
          }
          if (options.canvasDetached) signals.canvasClean.value = true
          signals.nonCanvasSavedRevision.value = nonCanvasRevision
          signals.autosaveFailed.value = false
        })
        return 'applied'
      },
      updatePath(path) {
        if (
          generation !== sessionGeneration
          || canvasRevision !== detachedCanvasRevision
        ) return false
        signals.designPath.value = path
        return true
      },
      setAutosaveFailed(failed) {
        if (
          generation !== sessionGeneration
          || canvasRevision !== detachedCanvasRevision
        ) return false
        signals.autosaveFailed.value = failed
        return true
      },
    }
    return Object.freeze(capture)
  })

  return store
}

export function createMemoryDesignSessionStore(
  initial: Partial<DesignSessionIdentity> = {},
): PersistenceCapableDesignSessionStore {
  const currentDesign = signal<CanopiFile | null>(initial.file ?? null)
  const designPath = signal<string | null>(initial.path ?? null)
  const designName = signal<string>(initial.name ?? initial.file?.name ?? 'Untitled')
  const nonCanvasRevision = signal(0)
  const nonCanvasSavedRevision = signal(0)
  const autosaveFailed = signal(false)
  const canvasClean = signal(true)
  const detachedCanvasDirty = signal(false)
  const pendingDesignPath = signal<string | null>(null)
  const pendingTemplateImport = signal<PendingTemplateImport | null>(null)
  const canvasDirty = computed(() => detachedCanvasDirty.value || !canvasClean.value)
  const designDirty = computed(() =>
    canvasDirty.value || nonCanvasRevision.value !== nonCanvasSavedRevision.value
  )

  return createDesignSessionStore({
    currentDesign,
    designPath,
    designName,
    nonCanvasRevision,
    nonCanvasSavedRevision,
    autosaveFailed,
    canvasClean,
    detachedCanvasDirty,
    pendingDesignPath,
    pendingTemplateImport,
    canvasDirty,
    designDirty,
  })
}

export const designSessionStore: PersistenceCapableDesignSessionStore = createDesignSessionStore({
  currentDesign: designState.currentDesign,
  designPath: designState.designPath,
  designName: designState.designName,
  nonCanvasRevision: designState.nonCanvasRevision,
  nonCanvasSavedRevision: designState.nonCanvasSavedRevision,
  autosaveFailed: designState.autosaveFailed,
  canvasClean: designState.canvasClean,
  detachedCanvasDirty: designState.detachedCanvasDirty,
  pendingDesignPath: designState.pendingDesignPath,
  pendingTemplateImport: designState.pendingTemplateImport,
  canvasDirty: designState.canvasDirty,
  designDirty: designState.designDirty,
})

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
