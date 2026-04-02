import { getCommonNames } from '../../ipc/species'

export class CanvasPlantLabelResolver {
  private readonly _byLocale = new Map<string, Map<string, string | null>>()

  getLocaleSnapshot(locale: string): ReadonlyMap<string, string | null> {
    return this._byLocale.get(locale) ?? new Map()
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

    let localizedNames: Record<string, string>
    try {
      localizedNames = await getCommonNames(missingNames, locale)
    } catch {
      return false
    }

    for (const canonicalName of missingNames) {
      cache.set(canonicalName, localizedNames[canonicalName] ?? null)
    }
    this._byLocale.set(locale, cache)
    return true
  }
}
