import { signal, type Signal } from '@preact/signals'
import {
  checkPlantCompatibility,
  suggestReplacements,
  type CompatibilityResult,
  type ReplacementSuggestion,
} from '../../ipc/adaptation'

export type { CompatibilityResult, ReplacementSuggestion }

export interface TemplateAdaptationController {
  results: Signal<CompatibilityResult[]>
  loading: Signal<boolean>
  errorMessage: Signal<string | null>
  setRequest(canonicalNames: string[], targetHardiness: number, locale: string): void
  dispose(): void
}

export interface ReplacementSuggestionsController {
  replacements: Signal<ReplacementSuggestion[]>
  loading: Signal<boolean>
  errorMessage: Signal<string | null>
  expanded: Signal<boolean>
  toggle(canonicalName: string, targetHardiness: number, locale: string): Promise<void>
  dispose(): void
}

interface CreateTemplateAdaptationControllerOptions {
  loadCompatibility?: typeof checkPlantCompatibility
}

interface CreateReplacementSuggestionsControllerOptions {
  loadSuggestions?: typeof suggestReplacements
}

export function createTemplateAdaptationController(
  options: CreateTemplateAdaptationControllerOptions = {},
): TemplateAdaptationController {
  const loadCompatibility = options.loadCompatibility ?? checkPlantCompatibility

  const results = signal<CompatibilityResult[]>([])
  const loading = signal(true)
  const errorMessage = signal<string | null>(null)

  let disposed = false
  let generation = 0
  let requestKey = ''

  function setRequest(canonicalNames: string[], targetHardiness: number, locale: string): void {
    const nextKey = JSON.stringify([canonicalNames, targetHardiness, locale])
    if (nextKey === requestKey) return

    requestKey = nextKey
    const requestGeneration = ++generation
    loading.value = true
    errorMessage.value = null

    void loadCompatibility(canonicalNames, targetHardiness, locale)
      .then((nextResults) => {
        if (disposed || requestGeneration !== generation) return
        results.value = nextResults
        loading.value = false
      })
      .catch((caught) => {
        if (disposed || requestGeneration !== generation) return
        results.value = []
        errorMessage.value = caught instanceof Error ? caught.message : String(caught)
        loading.value = false
      })
  }

  function dispose(): void {
    disposed = true
    generation += 1
  }

  return {
    results,
    loading,
    errorMessage,
    setRequest,
    dispose,
  }
}

export function createReplacementSuggestionsController(
  options: CreateReplacementSuggestionsControllerOptions = {},
): ReplacementSuggestionsController {
  const loadSuggestions = options.loadSuggestions ?? suggestReplacements

  const replacements = signal<ReplacementSuggestion[]>([])
  const loading = signal(false)
  const errorMessage = signal<string | null>(null)
  const expanded = signal(false)

  let disposed = false
  let generation = 0

  async function toggle(canonicalName: string, targetHardiness: number, locale: string): Promise<void> {
    if (expanded.value) {
      expanded.value = false
      return
    }

    const requestGeneration = ++generation
    loading.value = true
    errorMessage.value = null

    try {
      replacements.value = await loadSuggestions(canonicalName, targetHardiness, 5, locale)
      if (disposed || requestGeneration !== generation) return
    } catch (caught) {
      if (disposed || requestGeneration !== generation) return
      replacements.value = []
      errorMessage.value = caught instanceof Error ? caught.message : String(caught)
    } finally {
      if (disposed || requestGeneration !== generation) return
      loading.value = false
      expanded.value = true
    }
  }

  function dispose(): void {
    disposed = true
    generation += 1
  }

  return {
    replacements,
    loading,
    errorMessage,
    expanded,
    toggle,
    dispose,
  }
}
