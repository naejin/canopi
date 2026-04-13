import { signal, type Signal } from '@preact/signals'
import { getRecentFiles } from '../../ipc/design'
import type { DesignSummary } from '../../types/design'

export interface RecentFilesController {
  recentFiles: Signal<DesignSummary[]>
  load(): Promise<void>
  dispose(): void
}

interface CreateRecentFilesControllerOptions {
  loadRecentFiles?: typeof getRecentFiles
  maxItems?: number
}

export function createRecentFilesController(
  options: CreateRecentFilesControllerOptions = {},
): RecentFilesController {
  const loadRecentFiles = options.loadRecentFiles ?? getRecentFiles
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

  function dispose(): void {
    disposed = true
    generation += 1
  }

  return {
    recentFiles,
    load,
    dispose,
  }
}
