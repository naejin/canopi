import { describe, expect, it, vi } from 'vitest'
import { CanvasPlantLabelResolver } from './plant-labels'
import type { CanvasSpeciesDisplayNames } from './presentation-data'

// What the app's projection answers per language: the runtime never resolves names itself.
const DISPLAY: Record<string, CanvasSpeciesDisplayNames> = {
  fr: { names: { 'Malus domestica': 'Pommier', 'Ficus carica': 'Fig' }, englishFallbacks: ['Ficus carica'] },
  de: { names: { 'Malus domestica': 'Apple' }, englishFallbacks: ['Malus domestica'] },
  en: { names: { 'Malus domestica': 'Apple', 'Ficus carica': 'Fig' }, englishFallbacks: [] },
}

function createResolver() {
  const resolve = vi.fn(async (names: readonly string[], locale: string): Promise<CanvasSpeciesDisplayNames> => {
    const all = DISPLAY[locale] ?? { names: {}, englishFallbacks: [] }
    return {
      names: Object.fromEntries(names.flatMap((name) => all.names[name] ? [[name, all.names[name]!]] : [])),
      englishFallbacks: all.englishFallbacks.filter((name) => names.includes(name)),
    }
  })
  return { resolve, resolver: new CanvasPlantLabelResolver(resolve) }
}

describe('canvas plant label resolver', () => {
  it('keeps the locale names and the marked English fallbacks apart, and asks once per species', async () => {
    const { resolve, resolver } = createResolver()
    const names = ['Malus domestica', 'Ficus carica', 'Rubus idaeus']

    expect(await resolver.ensureEntries(names, 'fr')).toBe(true)

    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith(names, 'fr')
    expect(resolver.getLocaleSnapshot('fr').get('Malus domestica')).toBe('Pommier')
    expect(resolver.getLocaleSnapshot('fr').get('Ficus carica')).toBeNull()
    expect(resolver.getLocaleSnapshot('fr').get('Rubus idaeus')).toBeNull()
    expect([...resolver.getEnglishFallbackSnapshot('fr')]).toEqual([['Ficus carica', 'Fig']])

    expect(await resolver.ensureEntries(names, 'fr')).toBe(false)
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('reports no English fallbacks in English', async () => {
    const { resolver } = createResolver()
    await resolver.ensureEntries(['Malus domestica', 'Rubus idaeus'], 'en')

    expect(resolver.getLocaleSnapshot('en').get('Malus domestica')).toBe('Apple')
    expect(resolver.getEnglishFallbackSnapshot('en').size).toBe(0)
  })

  it('keeps English fallbacks per locale', async () => {
    const { resolver } = createResolver()
    await resolver.ensureEntries(['Malus domestica'], 'de')

    expect(resolver.getEnglishFallbackSnapshot('de').get('Malus domestica')).toBe('Apple')
    expect(resolver.getEnglishFallbackSnapshot('fr').size).toBe(0)
  })

  it('leaves names unresolved when the projection fails, so the next refresh retries', async () => {
    const { resolve, resolver } = createResolver()
    resolve.mockRejectedValueOnce(new Error('catalog unavailable'))

    expect(await resolver.ensureEntries(['Malus domestica'], 'fr')).toBe(false)
    expect(resolver.getLocaleSnapshot('fr').has('Malus domestica')).toBe(false)
    expect(await resolver.ensureEntries(['Malus domestica'], 'fr')).toBe(true)
    expect(resolver.getLocaleSnapshot('fr').get('Malus domestica')).toBe('Pommier')
  })
})
