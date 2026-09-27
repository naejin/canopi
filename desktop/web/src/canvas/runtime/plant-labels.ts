import { getCommonNames } from '../../ipc/species'
import type { CanvasPlantLabelSource } from './presentation-data'

const ENGLISH = 'en'

export class CanvasPlantLabelResolver implements CanvasPlantLabelSource {
  private readonly _byLocale = new Map<string, Map<string, string | null>>()
  private readonly _englishFallbacks = new Map<string, Map<string, string>>()

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
    if (locale !== ENGLISH) await this._resolveEnglishFallbacks(missingNames.filter((name) => !cache.get(name)), locale)
    return true
  }

  /** Bounded to the names just found missing; the English names stay cached under `en`. */
  private async _resolveEnglishFallbacks(canonicalNames: string[], locale: string): Promise<void> {
    if (canonicalNames.length === 0) return
    await this.ensureEntries(canonicalNames, ENGLISH)
    const english = this.getLocaleSnapshot(ENGLISH)
    const fallbacks = this._englishFallbacks.get(locale) ?? new Map<string, string>()
    for (const canonicalName of canonicalNames) {
      const name = english.get(canonicalName)
      if (name) fallbacks.set(canonicalName, name)
    }
    this._englishFallbacks.set(locale, fallbacks)
  }
}
