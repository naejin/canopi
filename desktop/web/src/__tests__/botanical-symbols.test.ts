import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANT_SYMBOL_ID, PLANT_SYMBOL_IDS } from '../generated/known-canopi-keys'
import { resolvePlantSymbolId } from '../canvas/runtime/scene/plant-symbols'

describe('Plant Symbol catalog', () => {
  it('offers twelve botanical forms and four abstract choices with a neutral fallback', () => {
    expect(PLANT_SYMBOL_IDS).toEqual([
      'canopy', 'conifer', 'palm', 'shrub', 'herb', 'grass',
      'bamboo', 'fern', 'climber', 'groundcover', 'rosette', 'cactus', 'round', 'square', 'triangle', 'cross',
    ])
    expect(DEFAULT_PLANT_SYMBOL_ID).toBe('round')
    expect(resolvePlantSymbolId('bamboo')).toBe('bamboo')
    expect(resolvePlantSymbolId('square')).toBe('square')
    expect(resolvePlantSymbolId('tree')).toBe('round')
  })
})
