import { signal } from '@preact/signals'
import { useEffect, useMemo } from 'preact/hooks'
import { SUPPORTED_LOCALES } from '../../i18n'
import { speciesCatalogWorkbench } from '../plant-browser'

/**
 * Common names in every catalog language for the species a list shows, so the finder
 * matches "Apple", "Pommier" or "Apfel" whatever the interface language. Names load
 * once per species and language and stay cached for the app's lifetime; a failed
 * language load leaves the other names searchable.
 */
const namesByLocaleAndSpecies = new Map<string, string | null>()
const pending = new Set<string>()
const revision = signal(0)

const EMPTY: readonly string[] = []

export function useCatalogNamesInEveryLanguage(
  canonicalNames: readonly string[],
): (canonicalName: string) => readonly string[] {
  const key = [...canonicalNames].sort().join('\n')
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

export async function loadCatalogNames(canonicalNames: readonly string[]): Promise<void> {
  await Promise.all(SUPPORTED_LOCALES.map(async (locale) => {
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
    pending.clear()
  })
}
