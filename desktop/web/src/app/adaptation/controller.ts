import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals'
import {
  checkPlantCompatibility,
  suggestReplacements,
  type CompatibilityResult,
  type ReplacementSuggestion,
} from '../../ipc/adaptation'

export type { CompatibilityResult, ReplacementSuggestion }

export type SiteAdaptationStatus = 'compatible' | 'marginal' | 'incompatible' | 'unknown'

export interface SiteAdaptationBadge {
  readonly i18nKey: string | null
  readonly params?: Record<string, string>
  readonly literal?: string
}

export interface SiteAdaptationReviewRow {
  readonly result: CompatibilityResult
  readonly canonicalName: string
  readonly commonName: string | null
  readonly displayName: string
  readonly status: SiteAdaptationStatus
  readonly badge: SiteAdaptationBadge
  readonly showReplacementSuggestions: boolean
}

export interface SiteAdaptationReplacementRow {
  readonly suggestion: ReplacementSuggestion
  readonly canonicalName: string
  readonly displayName: string
  readonly hardinessLabel: string
}

export interface SiteAdaptationSummary {
  readonly compatibleCount: number
  readonly totalCount: number
}

export interface TemplateAdaptationController {
  results: Signal<CompatibilityResult[]>
  rows: ReadonlySignal<readonly SiteAdaptationReviewRow[]>
  summary: ReadonlySignal<SiteAdaptationSummary>
  loading: Signal<boolean>
  errorMessage: Signal<string | null>
  setRequest(canonicalNames: string[], targetHardiness: number, locale: string): void
  dispose(): void
}

export interface ReplacementSuggestionsController {
  replacements: Signal<ReplacementSuggestion[]>
  replacementRows: ReadonlySignal<readonly SiteAdaptationReplacementRow[]>
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

export function siteAdaptationStatusFor(
  result: CompatibilityResult,
): SiteAdaptationStatus {
  if (result.hardiness_min == null && result.hardiness_max == null) return 'unknown'
  if (result.is_compatible && result.zone_diff === 0) return 'compatible'
  if (result.is_compatible) return 'marginal'
  return 'incompatible'
}

export function buildSiteAdaptationReviewRow(
  result: CompatibilityResult,
): SiteAdaptationReviewRow {
  const status = siteAdaptationStatusFor(result)
  return {
    result,
    canonicalName: result.canonical_name,
    commonName: result.common_name,
    displayName: result.common_name ?? result.canonical_name,
    status,
    badge: badgeForStatus(status, result.zone_diff),
    showReplacementSuggestions: status === 'incompatible' || status === 'marginal',
  }
}

export function buildSiteAdaptationSummary(
  rows: readonly SiteAdaptationReviewRow[],
): SiteAdaptationSummary {
  return {
    compatibleCount: rows.filter((row) => row.status === 'compatible').length,
    totalCount: rows.length,
  }
}

export function buildSiteAdaptationReplacementRow(
  suggestion: ReplacementSuggestion,
): SiteAdaptationReplacementRow {
  return {
    suggestion,
    canonicalName: suggestion.canonical_name,
    displayName: suggestion.common_name ?? suggestion.canonical_name,
    hardinessLabel: hardinessLabel(suggestion.hardiness_min, suggestion.hardiness_max),
  }
}

export function createTemplateAdaptationController(
  options: CreateTemplateAdaptationControllerOptions = {},
): TemplateAdaptationController {
  const loadCompatibility = options.loadCompatibility ?? checkPlantCompatibility

  const results = signal<CompatibilityResult[]>([])
  const rows = computed(() => results.value.map(buildSiteAdaptationReviewRow))
  const summary = computed(() => buildSiteAdaptationSummary(rows.value))
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
    rows,
    summary,
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
  const replacementRows = computed(() => replacements.value.map(buildSiteAdaptationReplacementRow))
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
    replacementRows,
    loading,
    errorMessage,
    expanded,
    toggle,
    dispose,
  }
}

function badgeForStatus(
  status: SiteAdaptationStatus,
  zoneDiff: number,
): SiteAdaptationBadge {
  switch (status) {
    case 'compatible':
      return { i18nKey: 'adaptation.compatible' }
    case 'marginal':
    case 'incompatible':
      return {
        i18nKey: 'adaptation.hardinessWarning',
        params: { zones: String(zoneDiff) },
      }
    case 'unknown':
      return { i18nKey: null, literal: '?' }
  }
}

function hardinessLabel(min: number | null, max: number | null): string {
  if (min == null || max == null) return ''
  return `Z${min}\u2013${max}`
}
