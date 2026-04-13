import { getFlowerColorBatch, getSpeciesBatch } from '../../ipc/species'
import { isPlantDbUnavailableError } from '../../ipc/plant-db-errors'
import { getFlowerColorHex } from '../plant-colors'

export type SpeciesCacheEntry = Record<string, unknown>

export class CanvasSpeciesCache {
  private readonly _cache = new Map<string, SpeciesCacheEntry>()

  getCache(): Map<string, SpeciesCacheEntry> {
    return this._cache
  }

  async ensureEntries(
    canonicalNames: string[],
    activeLocale: string,
  ): Promise<boolean> {
    const missingNames = [...new Set(canonicalNames.filter((name) => name && !this._cache.has(name)))]
    if (missingNames.length === 0) return false

    let details: Awaited<ReturnType<typeof getSpeciesBatch>>
    let flowerColors: Awaited<ReturnType<typeof getFlowerColorBatch>>
    try {
      [details, flowerColors] = await Promise.all([
        getSpeciesBatch(missingNames, activeLocale),
        getFlowerColorBatch(missingNames),
      ])
    } catch (error) {
      if (!isPlantDbUnavailableError(error)) {
        throw error
      }
      for (const canonicalName of missingNames) {
        this._cache.set(canonicalName, {
          canonical_name: canonicalName,
          resolved_flower_color: null,
          resolved_flower_color_source: 'none',
        })
      }
      return true
    }
    const detailByName = new Map(
      details.map((detail) => [detail.canonical_name, detail as unknown as SpeciesCacheEntry]),
    )
    const flowerByName = new Map(flowerColors.map((entry) => [entry.canonical_name, entry]))

    for (const canonicalName of missingNames) {
      const detail = detailByName.get(canonicalName) ?? { canonical_name: canonicalName }
      const flower = flowerByName.get(canonicalName)
      this._cache.set(canonicalName, {
        ...detail,
        resolved_flower_color: flower?.flower_color ?? null,
        resolved_flower_color_source: flower?.source ?? 'none',
      })
    }

    return true
  }

  getSuggestedPlantColor(canonicalName: string): string | null {
    const detail = this._cache.get(canonicalName)
    return getFlowerColorHex(
      (detail?.resolved_flower_color as string | null | undefined)
      ?? (detail?.flower_color as string | null | undefined),
    )
  }
}
