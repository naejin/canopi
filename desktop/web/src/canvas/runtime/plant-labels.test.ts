import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ipc/species', () => ({
  getCommonNames: vi.fn(async () => ({})),
}))

import { getCommonNames } from '../../ipc/species'
import { CanvasPlantLabelResolver } from './plant-labels'

const CATALOG: Record<string, Record<string, string>> = {
  en: { 'Malus domestica': 'Apple', 'Ficus carica': 'Fig' },
  fr: { 'Malus domestica': 'Pommier' },
}

describe('canvas plant label resolver', () => {
  beforeEach(() => {
    vi.mocked(getCommonNames).mockReset()
    vi.mocked(getCommonNames).mockImplementation(async (names, locale) => Object.fromEntries(
      names.flatMap((name) => CATALOG[locale]?.[name] ? [[name, CATALOG[locale]![name]!]] : []),
    ))
  })

  it('resolves the English catalog name for species with no name in the locale', async () => {
    const resolver = new CanvasPlantLabelResolver()
    const names = ['Malus domestica', 'Ficus carica', 'Rubus idaeus']

    expect(await resolver.ensureEntries(names, 'fr')).toBe(true)

    expect(resolver.getLocaleSnapshot('fr').get('Malus domestica')).toBe('Pommier')
    expect(resolver.getLocaleSnapshot('fr').get('Ficus carica')).toBeNull()
    expect([...resolver.getEnglishFallbackSnapshot('fr')]).toEqual([['Ficus carica', 'Fig']])
    expect(getCommonNames).toHaveBeenLastCalledWith(['Ficus carica', 'Rubus idaeus'], 'en')

    vi.mocked(getCommonNames).mockClear()
    expect(await resolver.ensureEntries(names, 'fr')).toBe(false)
    expect(getCommonNames).not.toHaveBeenCalled()
  })

  it('reports no English fallbacks in English', async () => {
    const resolver = new CanvasPlantLabelResolver()
    await resolver.ensureEntries(['Malus domestica', 'Rubus idaeus'], 'en')

    expect(resolver.getLocaleSnapshot('en').get('Malus domestica')).toBe('Apple')
    expect(resolver.getEnglishFallbackSnapshot('en').size).toBe(0)
    expect(getCommonNames).toHaveBeenCalledTimes(1)
  })

  it('keeps English fallbacks per locale', async () => {
    const resolver = new CanvasPlantLabelResolver()
    await resolver.ensureEntries(['Malus domestica'], 'de')

    expect(resolver.getEnglishFallbackSnapshot('de').get('Malus domestica')).toBe('Apple')
    expect(resolver.getEnglishFallbackSnapshot('fr').size).toBe(0)
  })
})
