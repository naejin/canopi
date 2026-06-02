import { describe, expect, it } from 'vitest'

import type { ScenePlantEntity } from '../canvas/runtime/scene'
import {
  computePlantSpacingPositions,
  createPlantSpacingGeneratedPlants,
} from '../canvas/plant-spacing-sequence'

function sourcePlant(overrides: Partial<ScenePlantEntity> = {}): ScenePlantEntity {
  return {
    kind: 'plant',
    id: 'source',
    canonicalName: 'Malus domestica',
    commonName: 'Apple',
    color: '#884422',
    stratum: 'tree',
    canopySpreadM: 3,
    position: { x: 0, y: 0 },
    rotationDeg: 15,
    scale: 3,
    notes: 'Do not copy',
    plantedDate: '2026-03-01',
    quantity: 4,
    ...overrides,
  }
}

describe('Plant Spacing sequence math', () => {
  it('uses full intervals from source to endpoint and excludes the source', () => {
    expect(computePlantSpacingPositions({ x: 0, y: 0 }, { x: 5.2, y: 0 }, 2)).toEqual([
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ])
    expect(computePlantSpacingPositions({ x: 0, y: 0 }, { x: 5, y: 0 }, 2)).toEqual([
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ])
    expect(computePlantSpacingPositions({ x: 0, y: 0 }, { x: 4 + 1e-8, y: 0 }, 2)).toEqual([
      { x: 2, y: 0 },
      { x: 4 + 1e-8, y: 0 },
    ])
  })

  it('returns no generated positions for zero length, shorter than interval, or invalid intervals', () => {
    expect(computePlantSpacingPositions({ x: 0, y: 0 }, { x: 0, y: 0 }, 2)).toEqual([])
    expect(computePlantSpacingPositions({ x: 0, y: 0 }, { x: 1.9, y: 0 }, 2)).toEqual([])
    expect(computePlantSpacingPositions({ x: 0, y: 0 }, { x: 4, y: 0 }, 0)).toEqual([])
  })

  it('creates generated plants in order while copying only Plant Spacing fields', () => {
    const plants = createPlantSpacingGeneratedPlants(
      sourcePlant(),
      [{ x: 2, y: 0 }, { x: 4, y: 0 }],
      (index) => `generated-${index}`,
    )

    expect(plants.map((plant) => plant.id)).toEqual(['generated-0', 'generated-1'])
    expect(plants.map((plant) => plant.position)).toEqual([{ x: 2, y: 0 }, { x: 4, y: 0 }])
    expect(plants[0]).toMatchObject({
      kind: 'plant',
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#884422',
      stratum: 'tree',
      canopySpreadM: 3,
      rotationDeg: 15,
      scale: 3,
      notes: null,
      plantedDate: null,
      quantity: 1,
    })
  })
})
