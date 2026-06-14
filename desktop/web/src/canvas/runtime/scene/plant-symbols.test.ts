import { describe, expect, it } from 'vitest'
import { resolvePlantSymbolForPlant, resolvePlantSymbolId } from './plant-symbols'

describe('plant symbols', () => {
  it('resolves missing and unknown Plant Symbol IDs to round', () => {
    expect(resolvePlantSymbolId('triangle')).toBe('triangle')
    expect(resolvePlantSymbolId(null)).toBe('round')
    expect(resolvePlantSymbolId(undefined)).toBe('round')
    expect(resolvePlantSymbolId('spiral')).toBe('round')

    expect(
      resolvePlantSymbolForPlant(
        { canonicalName: 'Quercus robur', symbol: null },
        { 'Quercus robur': 'tree' },
      ),
    ).toBe('tree')
    expect(
      resolvePlantSymbolForPlant(
        { canonicalName: 'Quercus robur', symbol: 'spiral' },
        { 'Quercus robur': 'tree' },
      ),
    ).toBe('round')
  })
})
