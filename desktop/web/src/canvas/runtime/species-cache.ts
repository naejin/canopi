import Konva from 'konva'
import { getFlowerColorBatch, getSpeciesBatch } from '../../ipc/species'
import { getFlowerColorHex } from '../plant-colors'

export type SpeciesCacheEntry = Record<string, unknown>

export class CanvasSpeciesCache {
  private readonly _cache = new Map<string, SpeciesCacheEntry>()

  getCache(): Map<string, SpeciesCacheEntry> {
    return this._cache
  }

  async loadVisiblePlantEntries(
    plantsLayer: Konva.Layer | undefined,
    activeLocale: string,
  ): Promise<boolean> {
    if (!plantsLayer) return false

    const names = new Set<string>()
    plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
      const name = (node as Konva.Group).getAttr('data-canonical-name') as string
      if (name && !this._cache.has(name)) names.add(name)
    })

    return this.ensureEntries([...names], activeLocale)
  }

  async ensureEntries(
    canonicalNames: string[],
    activeLocale: string,
  ): Promise<boolean> {
    const missingNames = [...new Set(canonicalNames.filter((name) => name && !this._cache.has(name)))]
    if (missingNames.length === 0) return false

    const [details, flowerColors] = await Promise.all([
      getSpeciesBatch(missingNames, activeLocale),
      getFlowerColorBatch(missingNames),
    ])
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
