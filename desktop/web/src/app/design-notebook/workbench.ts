import { computed, signal, type ReadonlySignal } from '@preact/signals'
import {
  createNotebookSection,
  deleteNotebookSection,
  getDesignNotebook,
  getRecentFiles,
  moveDesignReferenceToSection,
  renameNotebookSection,
  reorderDesignReferences,
  reorderNotebookSections,
  setDesignReferencePinned,
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

export type DesignNotebookViewMode = 'all' | 'pinned'

export interface DesignNotebookView {
  readonly entries: readonly DesignNotebookEntry[]
  readonly visibleEntries: readonly DesignNotebookEntry[]
  readonly sections: readonly DesignNotebookSection[]
  readonly recentEntries: readonly DesignSummary[]
  readonly viewMode: DesignNotebookViewMode
  readonly canAddCurrentDesign: boolean
  readonly currentDesignPath: string | null
  readonly searchQuery: string
  readonly activePath: string | null
  readonly loading: boolean
  readonly loadError: boolean
}

export interface DesignNotebookWorkbench {
  readonly view: ReadonlySignal<DesignNotebookView>
  load(): Promise<void>
  loadRecentDesigns(): Promise<void>
  refresh(): Promise<void>
  setViewMode(mode: DesignNotebookViewMode): void
  setSearchQuery(query: string): void
  openEntry(path: string): Promise<void>
  addCurrentDesignToNotebook(sectionId: string | null): Promise<boolean>
  setEntryPinned(path: string, pinned: boolean): Promise<void>
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
  readonly createSection?: typeof createNotebookSection
  readonly renameSection?: typeof renameNotebookSection
  readonly deleteSection?: typeof deleteNotebookSection
  readonly moveEntryToSection?: typeof moveDesignReferenceToSection
  readonly setEntryPinned?: typeof setDesignReferencePinned
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
  const createSectionAdapter = options.createSection ?? createNotebookSection
  const renameSectionAdapter = options.renameSection ?? renameNotebookSection
  const deleteSectionAdapter = options.deleteSection ?? deleteNotebookSection
  const moveEntryToSectionAdapter = options.moveEntryToSection ?? moveDesignReferenceToSection
  const setEntryPinnedAdapter = options.setEntryPinned ?? setDesignReferencePinned
  const reorderSectionsAdapter = options.reorderSections ?? reorderNotebookSections
  const reorderEntriesAdapter = options.reorderEntries ?? reorderDesignReferences
  const activePath = options.activePath ?? designPath
  const currentDesign = options.currentDesign ?? currentDesignSignal

  const entries = signal<readonly DesignNotebookEntry[]>([])
  const sections = signal<readonly DesignNotebookSection[]>([])
  const recentEntries = signal<readonly DesignSummary[]>([])
  const viewMode = signal<DesignNotebookViewMode>('all')
  const searchQuery = signal('')
  const loading = signal(false)
  const loadError = signal(false)

  let disposed = false
  let generation = 0

  const view = computed<DesignNotebookView>(() => {
    const query = searchQuery.value
    const normalizedQuery = normalizeSearch(query)
    const mode = viewMode.value
    const currentPath = activePath.value
    const sourceEntries = mode === 'pinned'
      ? entries.value.filter((entry) => entry.pinned)
      : entries.value
    const currentPathListed = currentPath !== null && entries.value.some((entry) => entry.path === currentPath)

    return {
      entries: entries.value,
      visibleEntries: normalizedQuery.length === 0
        ? sourceEntries
        : sourceEntries.filter((entry) => matchesNotebookQuery(entry, normalizedQuery)),
      sections: sections.value,
      recentEntries: recentEntries.value,
      viewMode: mode,
      canAddCurrentDesign: currentDesign.value !== null && !currentPathListed,
      currentDesignPath: currentPath,
      searchQuery: query,
      activePath: currentPath,
      loading: loading.value,
      loadError: loadError.value,
    }
  })

  async function load(): Promise<void> {
    const requestGeneration = ++generation
    loading.value = true
    loadError.value = false

    try {
      const snapshot = await loadNotebook()
      if (isStale(requestGeneration)) return
      writeSnapshot(snapshot)
      loadError.value = false
    } catch {
      if (isStale(requestGeneration)) return
      entries.value = []
      sections.value = []
      loadError.value = true
    } finally {
      if (!isStale(requestGeneration)) {
        loading.value = false
      }
    }
  }

  async function loadRecentDesigns(): Promise<void> {
    try {
      recentEntries.value = (await loadRecentDesignsAdapter()).slice(0, MAX_RECENT_DESIGNS)
    } catch {
      recentEntries.value = []
    }
  }

  function isStale(requestGeneration: number): boolean {
    return disposed || requestGeneration !== generation
  }

  function writeSnapshot(snapshot: DesignNotebookSnapshot): void {
    entries.value = snapshot.entries
    sections.value = snapshot.sections
  }

  function setSearchQuery(query: string): void {
    searchQuery.value = query
  }

  function setViewMode(mode: DesignNotebookViewMode): void {
    viewMode.value = mode
  }

  async function openEntry(path: string): Promise<void> {
    await openDesign(path)
  }

  async function addCurrentDesignToNotebook(sectionId: string | null): Promise<boolean> {
    if (currentDesign.value === null) return false

    const pathBeforeSave = activePath.value
    if (pathBeforeSave) {
      await saveCurrent()
    } else {
      await saveAsCurrent()
    }

    const savedPath = activePath.value
    if (!savedPath) return false

    await load()
    if (sectionId) {
      await moveEntryToSection(savedPath, sectionId)
    }

    return entries.value.some((entry) => entry.path === savedPath)
  }

  async function setEntryPinned(path: string, pinned: boolean): Promise<void> {
    await setEntryPinnedAdapter(path, pinned)
    entries.value = entries.value.map((entry) =>
      entry.path === path
        ? { ...entry, pinned }
        : entry
    )
  }

  async function createSection(name: string): Promise<void> {
    const normalizedName = normalizeSectionName(name)
    if (!normalizedName) return
    const section = await createSectionAdapter(normalizedName)
    sections.value = [...sections.value, section].sort(compareNotebookSections)
  }

  async function renameSection(sectionId: string, name: string): Promise<void> {
    const normalizedName = normalizeSectionName(name)
    if (!normalizedName) return
    await renameSectionAdapter(sectionId, normalizedName)
    sections.value = sections.value.map((section) =>
      section.id === sectionId
        ? { ...section, name: normalizedName }
        : section
    )
  }

  async function deleteSection(sectionId: string): Promise<void> {
    await deleteSectionAdapter(sectionId)
    sections.value = sections.value.filter((section) => section.id !== sectionId)
    entries.value = entries.value.map((entry) =>
      entry.section_id === sectionId
        ? { ...entry, section_id: null }
        : entry
    )
  }

  async function moveEntryToSection(path: string, sectionId: string | null): Promise<void> {
    await moveEntryToSectionAdapter(path, sectionId)
    entries.value = entries.value.map((entry) =>
      entry.path === path
        ? { ...entry, section_id: sectionId }
        : entry
    )
  }

  async function reorderSections(sectionIds: readonly string[]): Promise<void> {
    const nextOrder = [...sectionIds]
    await reorderSectionsAdapter(nextOrder)
    sections.value = applyManualOrder(
      sections.value,
      nextOrder,
      (section) => section.id,
      (section, sortOrder) => ({ ...section, sort_order: sortOrder }),
      compareNotebookSections,
    )
  }

  async function reorderEntries(paths: readonly string[]): Promise<void> {
    const nextOrder = [...paths]
    await reorderEntriesAdapter(nextOrder)
    entries.value = applyManualOrder(
      entries.value,
      nextOrder,
      (entry) => entry.path,
      (entry, sortOrder) => ({ ...entry, sort_order: sortOrder }),
      compareNotebookEntries,
    )
  }

  function dispose(): void {
    disposed = true
    generation += 1
  }

  return {
    view,
    load,
    loadRecentDesigns,
    refresh: load,
    setViewMode,
    setSearchQuery,
    openEntry,
    addCurrentDesignToNotebook,
    setEntryPinned,
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

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function normalizeSectionName(value: string): string {
  return value.trim()
}

function matchesNotebookQuery(entry: DesignNotebookEntry, normalizedQuery: string): boolean {
  return normalizeSearch(entry.name).includes(normalizedQuery)
    || normalizeSearch(entry.path).includes(normalizedQuery)
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
