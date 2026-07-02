import { computed, signal, type ReadonlySignal } from '@preact/signals'
import { getDesignNotebookEntries } from '../../ipc/design'
import { openDesignFromPath } from '../document-session/actions'
import { designPath } from '../document-session/store'
import type { DesignSummary } from '../../types/design'

export interface DesignNotebookView {
  readonly entries: readonly DesignSummary[]
  readonly visibleEntries: readonly DesignSummary[]
  readonly searchQuery: string
  readonly activePath: string | null
  readonly loading: boolean
  readonly loadError: boolean
}

export interface DesignNotebookWorkbench {
  readonly view: ReadonlySignal<DesignNotebookView>
  load(): Promise<void>
  refresh(): Promise<void>
  setSearchQuery(query: string): void
  openEntry(path: string): Promise<void>
  dispose(): void
}

interface CreateDesignNotebookWorkbenchOptions {
  readonly loadEntries?: typeof getDesignNotebookEntries
  readonly openDesign?: typeof openDesignFromPath
  readonly activePath?: ReadonlySignal<string | null>
}

export function createDesignNotebookWorkbench(
  options: CreateDesignNotebookWorkbenchOptions = {},
): DesignNotebookWorkbench {
  const loadEntries = options.loadEntries ?? getDesignNotebookEntries
  const openDesign = options.openDesign ?? openDesignFromPath
  const activePath = options.activePath ?? designPath

  const entries = signal<readonly DesignSummary[]>([])
  const searchQuery = signal('')
  const loading = signal(false)
  const loadError = signal(false)

  let disposed = false
  let generation = 0

  const view = computed<DesignNotebookView>(() => {
    const query = searchQuery.value
    const normalizedQuery = normalizeSearch(query)
    const sourceEntries = entries.value

    return {
      entries: sourceEntries,
      visibleEntries: normalizedQuery.length === 0
        ? sourceEntries
        : sourceEntries.filter((entry) => matchesNotebookQuery(entry, normalizedQuery)),
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
      const nextEntries = await loadEntries()
      if (isStale(requestGeneration)) return
      entries.value = nextEntries
      loadError.value = false
    } catch {
      if (isStale(requestGeneration)) return
      entries.value = []
      loadError.value = true
    } finally {
      if (!isStale(requestGeneration)) {
        loading.value = false
      }
    }
  }

  function isStale(requestGeneration: number): boolean {
    return disposed || requestGeneration !== generation
  }

  function setSearchQuery(query: string): void {
    searchQuery.value = query
  }

  async function openEntry(path: string): Promise<void> {
    await openDesign(path)
  }

  function dispose(): void {
    disposed = true
    generation += 1
  }

  return {
    view,
    load,
    refresh: load,
    setSearchQuery,
    openEntry,
    dispose,
  }
}

export const designNotebookWorkbench = createDesignNotebookWorkbench()

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function matchesNotebookQuery(entry: DesignSummary, normalizedQuery: string): boolean {
  return normalizeSearch(entry.name).includes(normalizedQuery)
    || normalizeSearch(entry.path).includes(normalizedQuery)
}
