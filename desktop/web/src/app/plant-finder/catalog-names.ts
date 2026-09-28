import { signal } from '@preact/signals'
import { useEffect, useMemo } from 'preact/hooks'
import { SUPPORTED_LOCALES } from '../../i18n'
import { speciesCatalogWorkbench } from '../plant-browser'
import { locale } from '../settings/state'

/**
 * Common names in every catalog language for the species a list shows, so the finder
 * matches "Apple", "Pommier" or "Apfel" whatever the interface language. Names load
 * once per species and language and stay cached for the app's lifetime; a failed
 * language load leaves the other names searchable.
 */
const namesByLocaleAndSpecies = new Map<string, string | null>()
const englishFallbackByLocaleAndSpecies = new Map<string, string | null>()
const pending = new Set<string>()
const fallbackPending = new Set<string>()
const revision = signal(0)

const EMPTY: readonly string[] = []
const NO_ENGLISH_NAMES: ReadonlyMap<string, string> = new Map()
const ENGLISH = 'en'

export function useCatalogNamesInEveryLanguage(
  canonicalNames: readonly string[],
): (canonicalName: string) => readonly string[] {
  const key = [...new Set(canonicalNames)].sort().join('\n')
  useEffect(() => {
    if (key) void loadCatalogNames(key.split('\n'))
  }, [key])
  const currentRevision = revision.value
  return useMemo(() => {
    void currentRevision
    return (canonicalName: string) => {
      const names = SUPPORTED_LOCALES
        .map((locale) => namesByLocaleAndSpecies.get(cacheKey(locale, canonicalName)))
        .filter((name): name is string => Boolean(name))
      return names.length > 0 ? names : EMPTY
    }
  }, [currentRevision])
}

/**
 * The English catalog name of each listed species that has no name in the interface
 * language, for lists that show it marked "(en)" (`SpeciesIdentity`'s `englishFallback`).
 * Read from the catalog's one display-name projection (`resolveDisplayNames`, cached
 * in the workbench); this module only keeps a synchronous snapshot for rendering.
 */
export function useEnglishFallbackNames(
  species: readonly { readonly canonicalName: string; readonly commonName?: string | null }[],
): ReadonlyMap<string, string> {
  const currentLocale = locale.value
  const english = currentLocale.split('-')[0] === ENGLISH
  const key = english
    ? ''
    : [...new Set(species.filter((entry) => !entry.commonName?.trim()).map((entry) => entry.canonicalName))].sort().join('\n')
  useEffect(() => {
    if (key) void loadEnglishFallbacks(key.split('\n'), currentLocale)
  }, [key, currentLocale])
  const currentRevision = revision.value
  return useMemo(() => {
    void currentRevision
    if (!key) return NO_ENGLISH_NAMES
    const names = new Map<string, string>()
    for (const canonicalName of key.split('\n')) {
      const name = englishFallbackByLocaleAndSpecies.get(cacheKey(currentLocale, canonicalName))
      if (name) names.set(canonicalName, name)
    }
    return names.size > 0 ? names : NO_ENGLISH_NAMES
  }, [key, currentLocale, currentRevision])
}

async function loadEnglishFallbacks(canonicalNames: readonly string[], requestedLocale: string): Promise<void> {
  const missing = canonicalNames.filter((name) => {
    const entry = cacheKey(requestedLocale, name)
    return !englishFallbackByLocaleAndSpecies.has(entry) && !fallbackPending.has(entry)
  })
  if (missing.length === 0) return
  for (const name of missing) fallbackPending.add(cacheKey(requestedLocale, name))
  try {
    const display = await speciesCatalogWorkbench.resolveDisplayNames(missing, requestedLocale)
    const fallbacks = new Set(display.englishFallbacks)
    for (const name of missing) {
      englishFallbackByLocaleAndSpecies.set(cacheKey(requestedLocale, name), fallbacks.has(name) ? display.names[name] ?? null : null)
    }
    revision.value += 1
  } catch {
    // Without the catalog the list shows scientific names; the next mount retries.
  } finally {
    for (const name of missing) fallbackPending.delete(cacheKey(requestedLocale, name))
  }
}

async function loadCatalogNames(
  canonicalNames: readonly string[],
  locales: readonly string[] = SUPPORTED_LOCALES,
): Promise<void> {
  await Promise.all(locales.map(async (locale) => {
    const missing = canonicalNames.filter((name) => {
      const entry = cacheKey(locale, name)
      return !namesByLocaleAndSpecies.has(entry) && !pending.has(entry)
    })
    if (missing.length === 0) return
    for (const name of missing) pending.add(cacheKey(locale, name))
    try {
      const names = await speciesCatalogWorkbench.resolveCommonNames(missing, locale)
      for (const name of missing) namesByLocaleAndSpecies.set(cacheKey(locale, name), names[name] ?? null)
      revision.value += 1
    } catch {
      // A language that fails to load stays unsearchable; the next list mount retries it.
    } finally {
      for (const name of missing) pending.delete(cacheKey(locale, name))
    }
  }))
}

function cacheKey(locale: string, canonicalName: string): string {
  return `${locale}\u0000${canonicalName}`
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    namesByLocaleAndSpecies.clear()
    englishFallbackByLocaleAndSpecies.clear()
    pending.clear()
    fallbackPending.clear()
  })
}
