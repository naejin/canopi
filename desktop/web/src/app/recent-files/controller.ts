import { signal, type Signal } from '@preact/signals'
import { getRecentFiles, removeRecentDesign, showRecentDesignInFolder } from '../../ipc/design'
import type { DesignSummary } from '../../types/design'

export interface RecentFilesController {
  recentFiles: Signal<DesignSummary[]>
  load(): Promise<void>
  /** Forget a Design on the list; the file is untouched. */
  remove(path: string): Promise<void>
  /** Open the folder of a Design on the list. */
  showInFolder(path: string): Promise<void>
  dispose(): void
}

interface CreateRecentFilesControllerOptions {
  loadRecentFiles?: typeof getRecentFiles
  removeRecentFile?: typeof removeRecentDesign
  showRecentFileInFolder?: typeof showRecentDesignInFolder
  maxItems?: number
}

export function createRecentFilesController(
  options: CreateRecentFilesControllerOptions = {},
): RecentFilesController {
  const loadRecentFiles = options.loadRecentFiles ?? getRecentFiles
  const removeRecentFile = options.removeRecentFile ?? removeRecentDesign
  const showInFolder = options.showRecentFileInFolder ?? showRecentDesignInFolder
  const maxItems = options.maxItems ?? 5
  const recentFiles = signal<DesignSummary[]>([])

  let disposed = false
  let generation = 0

  async function load(): Promise<void> {
    const requestGeneration = ++generation
    try {
      const files = await loadRecentFiles()
      if (disposed || requestGeneration !== generation) return
      recentFiles.value = files.slice(0, maxItems)
    } catch {
      if (disposed || requestGeneration !== generation) return
      recentFiles.value = []
    }
  }

  async function remove(path: string): Promise<void> {
    await removeRecentFile(path)
    if (disposed) return
    // A load in flight may still list it; the next one will not.
    recentFiles.value = recentFiles.value.filter((file) => file.path !== path)
    await load()
  }

  function dispose(): void {
    disposed = true
    generation += 1
  }

  return {
    recentFiles,
    load,
    remove,
    showInFolder,
    dispose,
  }
}
