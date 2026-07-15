import { computed, signal, type ReadonlySignal } from '@preact/signals'
import {
  addDesignReferenceToNotebook,
  createNotebookSection,
  deleteNotebookSection,
  getDesignNotebook,
  getRecentFiles,
  moveDesignReferenceToSection,
  renameNotebookSection,
  removeDesignReference,
  reorderDesignReferences,
  reorderNotebookSections,
} from '../../ipc/design'
import {
  openDesignFromPath,
  saveAsCurrentDesign,
  saveCurrentDesign,
} from '../document-session/actions'
import { currentDesign as currentDesignSignal, designPath } from '../document-session/store'
import type {
  CanopiFile,
  DesignNotebookEntry,
  DesignNotebookSection,
  DesignNotebookSnapshot,
  DesignSummary,
} from '../../types/design'

const MAX_RECENT_DESIGNS = 5

export interface DesignNotebookView {
  readonly entries: readonly DesignNotebookEntry[]
  readonly visibleEntries: readonly DesignNotebookEntry[]
  readonly sections: readonly DesignNotebookSection[]
  readonly recentEntries: readonly DesignSummary[]
  readonly canAddCurrentDesign: boolean
  readonly currentDesignPath: string | null
  readonly activePath: string | null
  readonly loading: boolean
  readonly loadError: boolean
}

export interface DesignNotebookWorkbench {
  readonly view: ReadonlySignal<DesignNotebookView>
  load(): Promise<void>
  loadRecentDesigns(): Promise<void>
  refresh(): Promise<void>
  openEntry(path: string): Promise<void>
  addCurrentDesignToNotebook(sectionId: string | null): Promise<boolean>
  removeEntry(path: string): Promise<void>
  createSection(name: string): Promise<void>
  renameSection(sectionId: string, name: string): Promise<void>
  deleteSection(sectionId: string): Promise<void>
  moveEntryToSection(path: string, sectionId: string | null): Promise<void>
  reorderSections(sectionIds: readonly string[]): Promise<void>
  reorderEntries(paths: readonly string[]): Promise<void>
  dispose(): void
}

interface CreateDesignNotebookWorkbenchOptions {
  readonly loadNotebook?: typeof getDesignNotebook
  readonly loadRecentDesigns?: typeof getRecentFiles
  readonly openDesign?: typeof openDesignFromPath
  readonly saveCurrent?: typeof saveCurrentDesign
  readonly saveAsCurrent?: typeof saveAsCurrentDesign
  readonly addDesignReference?: typeof addDesignReferenceToNotebook
  readonly createSection?: typeof createNotebookSection
  readonly renameSection?: typeof renameNotebookSection
  readonly deleteSection?: typeof deleteNotebookSection
  readonly moveEntryToSection?: typeof moveDesignReferenceToSection
  readonly removeEntry?: typeof removeDesignReference
  readonly reorderSections?: typeof reorderNotebookSections
  readonly reorderEntries?: typeof reorderDesignReferences
  readonly activePath?: ReadonlySignal<string | null>
  readonly currentDesign?: ReadonlySignal<CanopiFile | null>
}

export function createDesignNotebookWorkbench(
  options: CreateDesignNotebookWorkbenchOptions = {},
): DesignNotebookWorkbench {
  const loadNotebook = options.loadNotebook ?? getDesignNotebook
  const loadRecentDesignsAdapter = options.loadRecentDesigns ?? getRecentFiles
  const openDesign = options.openDesign ?? openDesignFromPath
  const saveCurrent = options.saveCurrent ?? saveCurrentDesign
  const saveAsCurrent = options.saveAsCurrent ?? saveAsCurrentDesign
  const addDesignReferenceAdapter = options.addDesignReference ?? addDesignReferenceToNotebook
  const createSectionAdapter = options.createSection ?? createNotebookSection
  const renameSectionAdapter = options.renameSection ?? renameNotebookSection
  const deleteSectionAdapter = options.deleteSection ?? deleteNotebookSection
  const moveEntryToSectionAdapter = options.moveEntryToSection ?? moveDesignReferenceToSection
  const removeEntryAdapter = options.removeEntry ?? removeDesignReference
  const reorderSectionsAdapter = options.reorderSections ?? reorderNotebookSections
  const reorderEntriesAdapter = options.reorderEntries ?? reorderDesignReferences
  const activePath = options.activePath ?? designPath
  const currentDesign = options.currentDesign ?? currentDesignSignal

  const entries = signal<readonly DesignNotebookEntry[]>([])
  const sections = signal<readonly DesignNotebookSection[]>([])
  const recentEntries = signal<readonly DesignSummary[]>([])
  const loading = signal(false)
  const loadError = signal(false)

  let disposed = false
  let lifetimeGeneration = 0
  let generation = 0
  let recentGeneration = 0
  let snapshotEpoch = 0
  let mutationTail = Promise.resolve()

  const view = computed<DesignNotebookView>(() => {
    const currentPath = activePath.value
    const currentPathListed = currentPath !== null && entries.value.some((entry) => entry.path === currentPath)

    return {
      entries: entries.value,
      visibleEntries: entries.value,
      sections: sections.value,
      recentEntries: recentEntries.value,
      canAddCurrentDesign: currentDesign.value !== null && !currentPathListed,
      currentDesignPath: currentPath,
      activePath: currentPath,
      loading: loading.value,
      loadError: loadError.value,
    }
  })

  async function load(): Promise<void> {
    if (disposed) return
    const requestGeneration = ++generation
    const requestSnapshotEpoch = snapshotEpoch
    const admittedLifetime = lifetimeGeneration
    const mutationBarrier = mutationTail
    loading.value = true
    loadError.value = false

    try {
      await mutationBarrier
      if (
        !isLifetimeCurrent(admittedLifetime)
        || isLoadStale(requestGeneration, requestSnapshotEpoch)
      ) return
      const snapshot = await loadNotebook()
      if (
        !isLifetimeCurrent(admittedLifetime)
        || isLoadStale(requestGeneration, requestSnapshotEpoch)
      ) return
      writeSnapshot(snapshot)
      loadError.value = false
    } catch {
      if (isLoadStale(requestGeneration, requestSnapshotEpoch)) return
      entries.value = []
      sections.value = []
      loadError.value = true
    } finally {
      if (isCurrentLoad(requestGeneration)) {
        loading.value = false
      }
    }
  }

  async function loadRecentDesigns(): Promise<void> {
    if (disposed) return
    const requestGeneration = ++recentGeneration
    const admittedLifetime = lifetimeGeneration
    try {
      const nextRecentEntries = (await loadRecentDesignsAdapter()).slice(0, MAX_RECENT_DESIGNS)
      if (
        !isLifetimeCurrent(admittedLifetime)
        || isRecentStale(requestGeneration)
      ) return
      recentEntries.value = nextRecentEntries
    } catch {
      if (
        !isLifetimeCurrent(admittedLifetime)
        || isRecentStale(requestGeneration)
      ) return
      recentEntries.value = []
    }
  }

  function isLoadStale(requestGeneration: number, requestSnapshotEpoch: number): boolean {
    return !isCurrentLoad(requestGeneration) || requestSnapshotEpoch !== snapshotEpoch
  }

  function isCurrentLoad(requestGeneration: number): boolean {
    return !disposed && requestGeneration === generation
  }

  function isRecentStale(requestGeneration: number): boolean {
    return disposed || requestGeneration !== recentGeneration
  }

  function writeSnapshot(snapshot: DesignNotebookSnapshot): void {
    entries.value = snapshot.entries
    sections.value = snapshot.sections
  }

  async function openEntry(path: string): Promise<void> {
    if (disposed) return
    const admittedLifetime = lifetimeGeneration
    await openDesign(path)
    if (!isLifetimeCurrent(admittedLifetime)) return
  }

  function addCurrentDesignToNotebook(sectionId: string | null): Promise<boolean> {
    if (currentDesign.value === null) return Promise.resolve(false)

    return enqueueMutation(false, async (admittedLifetime) => {
      if (currentDesign.value === null) return false
      const pathBeforeSave = activePath.value
      const settlement = pathBeforeSave
        ? await saveCurrent()
        : await saveAsCurrent()
      if (!isLifetimeCurrent(admittedLifetime)) return false
      if (settlement?.status !== 'applied' || !settlement.path) return false
      const savedPath = settlement.path
      const savedDesign = settlement.content

      await addDesignReferenceAdapter(savedPath, savedDesign)
      if (!isLifetimeCurrent(admittedLifetime)) return false
      const snapshot = await loadNotebook()
      if (!isLifetimeCurrent(admittedLifetime)) return false
      writeSnapshot(snapshot)

      const targetSectionId = validSectionId(sectionId, sections.value)
      if (targetSectionId) {
        await moveEntryToSectionAdapter(savedPath, targetSectionId)
        if (!isLifetimeCurrent(admittedLifetime)) return false
        entries.value = entries.value.map((entry) =>
          entry.path === savedPath
            ? { ...entry, section_id: targetSectionId }
            : entry
        )
      }

      return entries.value.some((entry) => entry.path === savedPath)
    })
  }

  function removeEntry(path: string): Promise<void> {
    if (path.trim().length === 0) return Promise.resolve()
    return enqueueMutation(undefined, async (admittedLifetime) => {
      await removeEntryAdapter(path)
      if (!isLifetimeCurrent(admittedLifetime)) return
      entries.value = entries.value.filter((entry) => entry.path !== path)
    })
  }

  function createSection(name: string): Promise<void> {
    const normalizedName = normalizeSectionName(name)
    if (!normalizedName) return Promise.resolve()
    return enqueueMutation(undefined, async (admittedLifetime) => {
      const section = await createSectionAdapter(normalizedName)
      if (!isLifetimeCurrent(admittedLifetime)) return
      sections.value = [...sections.value, section].sort(compareNotebookSections)
    })
  }

  function renameSection(sectionId: string, name: string): Promise<void> {
    const normalizedName = normalizeSectionName(name)
    if (!normalizedName) return Promise.resolve()
    return enqueueMutation(undefined, async (admittedLifetime) => {
      await renameSectionAdapter(sectionId, normalizedName)
      if (!isLifetimeCurrent(admittedLifetime)) return
      sections.value = sections.value.map((section) =>
        section.id === sectionId
          ? { ...section, name: normalizedName }
          : section
      )
    })
  }

  function deleteSection(sectionId: string): Promise<void> {
    return enqueueMutation(undefined, async (admittedLifetime) => {
      await deleteSectionAdapter(sectionId)
      if (!isLifetimeCurrent(admittedLifetime)) return
      sections.value = sections.value.filter((section) => section.id !== sectionId)
      entries.value = entries.value.map((entry) =>
        entry.section_id === sectionId
          ? { ...entry, section_id: null }
          : entry
      )
    })
  }

  function moveEntryToSection(path: string, sectionId: string | null): Promise<void> {
    return enqueueMutation(undefined, async (admittedLifetime) => {
      await moveEntryToSectionAdapter(path, sectionId)
      if (!isLifetimeCurrent(admittedLifetime)) return
      entries.value = entries.value.map((entry) =>
        entry.path === path
          ? { ...entry, section_id: sectionId }
          : entry
      )
    })
  }

  function reorderSections(sectionIds: readonly string[]): Promise<void> {
    const nextOrder = [...sectionIds]
    return enqueueMutation(undefined, async (admittedLifetime) => {
      await reorderSectionsAdapter(nextOrder)
      if (!isLifetimeCurrent(admittedLifetime)) return
      sections.value = applyManualOrder(
        sections.value,
        nextOrder,
        (section) => section.id,
        (section, sortOrder) => ({ ...section, sort_order: sortOrder }),
        compareNotebookSections,
      )
    })
  }

  function reorderEntries(paths: readonly string[]): Promise<void> {
    const nextOrder = [...paths]
    return enqueueMutation(undefined, async (admittedLifetime) => {
      await reorderEntriesAdapter(nextOrder)
      if (!isLifetimeCurrent(admittedLifetime)) return
      entries.value = applyManualOrder(
        entries.value,
        nextOrder,
        (entry) => entry.path,
        (entry, sortOrder) => ({ ...entry, sort_order: sortOrder }),
        compareNotebookEntries,
      )
    })
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    lifetimeGeneration += 1
    generation += 1
    recentGeneration += 1
  }

  function enqueueMutation<T>(
    disposedResult: T,
    operation: (admittedLifetime: number) => Promise<T>,
  ): Promise<T> {
    if (disposed) return Promise.resolve(disposedResult)
    snapshotEpoch += 1
    const admittedLifetime = lifetimeGeneration
    const run = () => isLifetimeCurrent(admittedLifetime)
      ? operation(admittedLifetime)
      : disposedResult
    const result = mutationTail.then(run, run)
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function isLifetimeCurrent(admittedLifetime: number): boolean {
    return !disposed && admittedLifetime === lifetimeGeneration
  }

  return {
    view,
    load,
    loadRecentDesigns,
    refresh: load,
    openEntry,
    addCurrentDesignToNotebook,
    removeEntry,
    createSection,
    renameSection,
    deleteSection,
    moveEntryToSection,
    reorderSections,
    reorderEntries,
    dispose,
  }
}

export const designNotebookWorkbench = createDesignNotebookWorkbench()

function normalizeSectionName(value: string): string {
  return value.trim()
}

function validSectionId(
  sectionId: string | null,
  availableSections: readonly DesignNotebookSection[],
): string | null {
  const normalized = sectionId?.trim()
  if (!normalized) return null
  return availableSections.some((section) => section.id === normalized) ? normalized : null
}

function applyManualOrder<T>(
  items: readonly T[],
  orderedKeys: readonly string[],
  keyForItem: (item: T) => string,
  withSortOrder: (item: T, sortOrder: number) => T,
  compare: (left: T, right: T) => number,
): readonly T[] {
  const orderByKey = new Map(orderedKeys.map((key, index) => [key, index]))
  return items
    .map((item) => {
      const order = orderByKey.get(keyForItem(item))
      return order === undefined ? item : withSortOrder(item, order)
    })
    .sort(compare)
}

function compareNotebookSections(left: DesignNotebookSection, right: DesignNotebookSection): number {
  return left.sort_order - right.sort_order
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id)
}

function compareNotebookEntries(left: DesignNotebookEntry, right: DesignNotebookEntry): number {
  return left.sort_order - right.sort_order
    || right.updated_at.localeCompare(left.updated_at)
    || left.path.localeCompare(right.path)
}
