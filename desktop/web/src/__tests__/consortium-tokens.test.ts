import { describe, expect, it } from 'vitest'
import type { PlacedPlant } from '../types/design'
import {
  buildPlantLookup,
  formatPlantTokenForEdit,
  resolvePlantTokens,
} from '../components/canvas/consortium-tokens'

const PLANTS: PlacedPlant[] = [
  {
    id: 'plant-1',
    canonical_name: 'malus-domestica',
    common_name: 'Apple',
    position: { x: 0, y: 0 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: null,
  },
  {
    id: 'plant-2',
    canonical_name: 'malus-domestica',
    common_name: 'Apple',
    position: { x: 1, y: 1 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: null,
  },
]

describe('consortium token helpers', () => {
  it('formats known plant ids with a visible id suffix for roundtrip-safe editing', () => {
    const lookup = buildPlantLookup(PLANTS)

    expect(formatPlantTokenForEdit('plant-1', lookup)).toBe('Apple [plant-1]')
    expect(formatPlantTokenForEdit('unknown-token', lookup)).toBe('unknown-token')
  })

  it('preserves duplicate common-name plants when parsing edit input', () => {
    const parsed = resolvePlantTokens('Apple [plant-1], Apple [plant-2]', PLANTS)

    expect(parsed).toEqual(['plant-1', 'plant-2'])
  })
})
