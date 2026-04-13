import { signal, type Signal } from '@preact/signals'
import { getLocaleCommonNames, getSpeciesDetail } from '../../ipc/species'
import type { CommonNameEntry, SpeciesDetail } from '../../types/species'

export type PlantDetailLoadState = 'loading' | 'loaded' | 'error'

export interface PlantDetailController {
  detail: Signal<SpeciesDetail | null>
  loadState: Signal<PlantDetailLoadState>
  errorMessage: Signal<string | null>
  secondaryNames: Signal<CommonNameEntry[]>
  setTarget(canonicalName: string, locale: string): void
  retry(): void
  dispose(): void
}

interface CreatePlantDetailControllerOptions {
  loadDetail?: typeof getSpeciesDetail
  loadLocaleCommonNames?: typeof getLocaleCommonNames
}

export function createPlantDetailController(
  options: CreatePlantDetailControllerOptions = {},
): PlantDetailController {
  const loadDetail = options.loadDetail ?? getSpeciesDetail
  const loadLocaleCommonNames = options.loadLocaleCommonNames ?? getLocaleCommonNames

  const detail = signal<SpeciesDetail | null>(null)
  const loadState = signal<PlantDetailLoadState>('loading')
  const errorMessage = signal<string | null>(null)
  const secondaryNames = signal<CommonNameEntry[]>([])

  let currentCanonicalName = ''
  let currentLocale = ''
  let generation = 0
  let disposed = false

  function beginLoad(): void {
    if (!currentCanonicalName) return
    const requestGeneration = ++generation

    detail.value = null
    loadState.value = 'loading'
    errorMessage.value = null
    secondaryNames.value = []

    void loadDetail(currentCanonicalName, currentLocale)
      .then((nextDetail) => {
        if (disposed || requestGeneration !== generation) return
        detail.value = nextDetail
        loadState.value = 'loaded'
      })
      .catch((error) => {
        if (disposed || requestGeneration !== generation) return
        errorMessage.value = error instanceof Error ? error.message : String(error)
        loadState.value = 'error'
      })

    void loadLocaleCommonNames(currentCanonicalName, currentLocale)
      .then((entries) => {
        if (disposed || requestGeneration !== generation) return
        secondaryNames.value = entries
      })
      .catch(() => {
        // Secondary locale names are optional and should not block detail rendering.
      })
  }

  function setTarget(canonicalName: string, locale: string): void {
    if (canonicalName === currentCanonicalName && locale === currentLocale) return
    currentCanonicalName = canonicalName
    currentLocale = locale
    beginLoad()
  }

  function retry(): void {
    beginLoad()
  }

  function dispose(): void {
    disposed = true
    generation += 1
  }

  return {
    detail,
    loadState,
    errorMessage,
    secondaryNames,
    setTarget,
    retry,
    dispose,
  }
}
