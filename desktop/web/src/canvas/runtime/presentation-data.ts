export type SpeciesCacheEntry = Record<string, unknown>

export interface CanvasPlantLabelSource {
  getLocaleSnapshot(locale: string): ReadonlyMap<string, string | null>
  ensureEntries(canonicalNames: string[], locale: string): Promise<boolean>
}

export interface CanvasSpeciesPresentationCache {
  getCache(): Map<string, SpeciesCacheEntry>
  ensureEntries(canonicalNames: string[], activeLocale: string): Promise<boolean>
  getSuggestedPlantColor(canonicalName: string): string | null
}

export function createDetachedCanvasPlantLabelSource(): CanvasPlantLabelSource {
  return {
    getLocaleSnapshot: () => new Map(),
    ensureEntries: async () => false,
  }
}

export function createDetachedCanvasSpeciesPresentationCache(): CanvasSpeciesPresentationCache {
  const cache = new Map<string, SpeciesCacheEntry>()
  return {
    getCache: () => cache,
    ensureEntries: async (canonicalNames) => {
      const missing = canonicalNames.filter((name) => name && !cache.has(name))
      for (const canonicalName of missing) {
        cache.set(canonicalName, {
          canonical_name: canonicalName,
          resolved_flower_color: null,
          resolved_flower_color_source: 'none',
        })
      }
      return missing.length > 0
    },
    getSuggestedPlantColor: () => null,
  }
}
