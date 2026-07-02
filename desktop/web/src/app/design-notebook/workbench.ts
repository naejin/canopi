import { computed, signal, type ReadonlySignal } from '@preact/signals'
import {
  createNotebookSection,
  deleteNotebookSection,
  getDesignNotebook,
  getRecentFiles,
  moveDesignReferenceToSection,
  renameNotebookSection,
  setDesignReferencePinned,
} from '../../ipc/design'
import { openDesignFromPath } from '../document-session/actions'
import { designPath } from '../document-session/store'
import type {
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
  setEntryPinned(path: string, pinned: boolean): Promise<void>
  createSection(name: string): Promise<void>
  renameSection(sectionId: string, name: string): Promise<void>
  deleteSection(sectionId: string): Promise<void>
  moveEntryToSection(path: string, sectionId: string | null): Promise<void>
  dispose(): void
}

interface CreateDesignNotebookWorkbenchOptions {
  readonly loadNotebook?: typeof getDesignNotebook
  readonly loadRecentDesigns?: typeof getRecentFiles
  readonly openDesign?: typeof openDesignFromPath
  readonly createSection?: typeof createNotebookSection
  readonly renameSection?: typeof renameNotebookSection
  readonly deleteSection?: typeof deleteNotebookSection
  readonly moveEntryToSection?: typeof moveDesignReferenceToSection
  readonly setEntryPinned?: typeof setDesignReferencePinned
  readonly activePath?: ReadonlySignal<string | null>
}

export function createDesignNotebookWorkbench(
  options: CreateDesignNotebookWorkbenchOptions = {},
): DesignNotebookWorkbench {
  const loadNotebook = options.loadNotebook ?? getDesignNotebook
  const loadRecentDesignsAdapter = options.loadRecentDesigns ?? getRecentFiles
  const openDesign = options.openDesign ?? openDesignFromPath
  const createSectionAdapter = options.createSection ?? createNotebookSection
  const renameSectionAdapter = options.renameSection ?? renameNotebookSection
  const deleteSectionAdapter = options.deleteSection ?? deleteNotebookSection
  const moveEntryToSectionAdapter = options.moveEntryToSection ?? moveDesignReferenceToSection
  const setEntryPinnedAdapter = options.setEntryPinned ?? setDesignReferencePinned
  const activePath = options.activePath ?? designPath

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
    const sourceEntries = mode === 'pinned'
      ? entries.value.filter((entry) => entry.pinned)
      : entries.value

    return {
      entries: entries.value,
      visibleEntries: normalizedQuery.length === 0
        ? sourceEntries
        : sourceEntries.filter((entry) => matchesNotebookQuery(entry, normalizedQuery)),
      sections: sections.value,
      recentEntries: recentEntries.value,
      viewMode: mode,
      searchQuery: query,
      activePath: activePath.value,
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
    sections.value = [...sections.value, section]
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
    setEntryPinned,
    createSection,
    renameSection,
    deleteSection,
    moveEntryToSection,
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
