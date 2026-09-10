import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANT_SYMBOL_ID, PLANT_SYMBOL_IDS } from '../generated/known-canopi-keys'
import { resolvePlantSymbolId } from '../canvas/runtime/scene/plant-symbols'

describe('botanical Plant Symbol catalog', () => {
  it('offers twelve botanical forms and a neutral fallback instead of the old geometric set', () => {
    expect(PLANT_SYMBOL_IDS).toEqual([
      'canopy', 'conifer', 'palm', 'shrub', 'herb', 'grass',
      'bamboo', 'fern', 'climber', 'groundcover', 'rosette', 'cactus', 'round',
    ])
    expect(DEFAULT_PLANT_SYMBOL_ID).toBe('round')
    expect(resolvePlantSymbolId('bamboo')).toBe('bamboo')
    expect(resolvePlantSymbolId('square')).toBe('round')
    expect(resolvePlantSymbolId('tree')).toBe('round')
  })
})
