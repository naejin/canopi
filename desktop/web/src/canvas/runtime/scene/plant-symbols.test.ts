import { describe, expect, it } from 'vitest'
import { resolvePlantSymbolForPlant, resolvePlantSymbolId } from './plant-symbols'

describe('plant symbols', () => {
  it('resolves missing and unknown Plant Symbol IDs to round', () => {
    expect(resolvePlantSymbolId('conifer')).toBe('conifer')
    expect(resolvePlantSymbolId('groundcover')).toBe('groundcover')
    expect(resolvePlantSymbolId('fern')).toBe('fern')
    expect(resolvePlantSymbolId(null)).toBe('round')
    expect(resolvePlantSymbolId(undefined)).toBe('round')
    expect(resolvePlantSymbolId('spiral')).toBe('round')

    expect(
      resolvePlantSymbolForPlant(
        { canonicalName: 'Quercus robur', symbol: null },
        { 'Quercus robur': 'canopy' },
      ),
    ).toBe('canopy')
    expect(
      resolvePlantSymbolForPlant(
        { canonicalName: 'Quercus robur', symbol: 'spiral' },
        { 'Quercus robur': 'canopy' },
      ),
    ).toBe('round')
  })
})
