import type {
  CanvasPlantLabelSource,
  CanvasSpeciesDisplayNameResolver,
  CanvasSpeciesDisplayNames,
} from './presentation-data'

/**
 * Per-locale label snapshots for the renderer, filled from the app's one
 * species display-name projection (Desktop: the Species Catalog Workbench,
 * which batches and caches). A failed lookup leaves the names unresolved so
 * the next refresh retries.
 */
export class CanvasPlantLabelResolver implements CanvasPlantLabelSource {
  private readonly _byLocale = new Map<string, Map<string, string | null>>()
  private readonly _englishFallbacks = new Map<string, Map<string, string>>()

  constructor(private readonly _resolveDisplayNames: CanvasSpeciesDisplayNameResolver) {}

  getLocaleSnapshot(locale: string): ReadonlyMap<string, string | null> {
    return this._byLocale.get(locale) ?? new Map()
  }

  getEnglishFallbackSnapshot(locale: string): ReadonlyMap<string, string> {
    return this._englishFallbacks.get(locale) ?? new Map()
  }

  async ensureEntries(
    canonicalNames: string[],
    locale: string,
  ): Promise<boolean> {
    const cache = this._byLocale.get(locale) ?? new Map<string, string | null>()
    const missingNames = [...new Set(canonicalNames.filter((name) => name && !cache.has(name)))]
    if (missingNames.length === 0) {
      if (!this._byLocale.has(locale)) {
        this._byLocale.set(locale, cache)
      }
      return false
    }

    let resolved: CanvasSpeciesDisplayNames
    try {
      resolved = await this._resolveDisplayNames(missingNames, locale)
    } catch {
      return false
    }

    const fallbackNames = new Set(resolved.englishFallbacks)
    const fallbacks = this._englishFallbacks.get(locale) ?? new Map<string, string>()
    for (const canonicalName of missingNames) {
      const name = resolved.names[canonicalName] ?? null
      if (name && fallbackNames.has(canonicalName)) {
        cache.set(canonicalName, null)
        fallbacks.set(canonicalName, name)
      } else {
        cache.set(canonicalName, name)
      }
    }
    this._byLocale.set(locale, cache)
    this._englishFallbacks.set(locale, fallbacks)
    return true
  }
}
