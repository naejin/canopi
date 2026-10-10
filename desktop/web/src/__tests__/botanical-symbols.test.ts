import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANT_SYMBOL_ID, PLANT_SYMBOL_IDS } from '../generated/known-canopi-keys'
import { resolvePlantSymbolId } from '../canvas/runtime/scene/plant-symbols'
import { PLANT_SYMBOL_FAMILIES } from '../canvas/runtime/plant-symbol-recipes'

const I18N_DIR = 'src/i18n'

describe('Plant Symbol catalog', () => {
  it('offers the 29 designed symbols in three families, four abstract marks and a neutral fallback', () => {
    expect(PLANT_SYMBOL_IDS).toEqual([
      'canopy', 'conifer', 'palm', 'shrub', 'herb', 'grass', 'bamboo', 'fern', 'climber', 'groundcover', 'rosette', 'cactus',
      'apple', 'nut', 'berry', 'grape', 'flower', 'pod',
      'carrot', 'grain', 'chili', 'medicinal', 'bee', 'biomass', 'timber', 'fodder', 'windbreak', 'soil', 'mushroom',
      'round', 'square', 'triangle', 'cross',
    ])
    expect(DEFAULT_PLANT_SYMBOL_ID).toBe('round')
    expect(resolvePlantSymbolId('bamboo')).toBe('bamboo')
    expect(resolvePlantSymbolId('mushroom')).toBe('mushroom')
    expect(resolvePlantSymbolId('tree')).toBe('round')
  })

  it('names every symbol and family in all 11 locales', () => {
    const locales = readdirSync(I18N_DIR).filter((file) => file.endsWith('.json'))
    expect(locales).toHaveLength(11)
    for (const file of locales) {
      const plantSymbol = JSON.parse(readFileSync(join(I18N_DIR, file), 'utf8')).canvas.plantSymbol
      expect(Object.keys(plantSymbol.names), file).toEqual([...PLANT_SYMBOL_IDS])
      expect(Object.keys(plantSymbol.families), file).toEqual(Object.keys(PLANT_SYMBOL_FAMILIES))
      for (const label of [...Object.values(plantSymbol.names), ...Object.values(plantSymbol.families)]) {
        expect(typeof label === 'string' && label.trim().length > 0, file).toBe(true)
      }
    }
  })
})
