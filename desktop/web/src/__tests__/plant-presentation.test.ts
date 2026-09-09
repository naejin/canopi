import { describe, expect, it } from 'vitest'
import type { ScenePlantEntity, SceneViewportState } from '../canvas/runtime/scene'
import {
  buildPlantPresentationEntries,
  buildPlantPresentationSnapshot,
  getPlantScreenHitBounds,
} from '../canvas/runtime/plant-presentation'

function createViewport(overrides: Partial<SceneViewportState> = {}): SceneViewportState {
  return {
    x: 0,
    y: 0,
    scale: 8,
    ...overrides,
  }
}

function createPlant(overrides: Partial<ScenePlantEntity> = {}): ScenePlantEntity {
  return {
    kind: 'plant' as const,
    id: 'plant-1',
    canonicalName: 'Malus domestica',
    commonName: 'Apple',
    color: null,
    stratum: null,
    canopySpreadM: null,
    position: { x: 10, y: 20 },
    rotationDeg: null,
    scale: null,
    notes: null,
    plantedDate: null,
    quantity: null,
    ...overrides,
    locked: overrides.locked ?? false,
  }
}

describe('plant presentation service', () => {
  it.each([10, 20, 40, 100, 200, 400])('keeps dense positions distinct and authored presentation intact at %s px/m', (scale) => {
    const plants = Array.from({ length: 2200 }, (_, index) => createPlant({
      id: String(index), position: { x: (index % 40) * .14, y: Math.floor(index / 40) * .27 },
      color: '#c44230', symbol: 'square',
    }))
    const before = JSON.stringify(plants)
    const presentation = buildPlantPresentationSnapshot(plants, {
      viewport: createViewport({ scale }), speciesCache: new Map(),
    }, new Set())
    expect(presentation.stackBadges).toHaveLength(0)
    expect(presentation.entries).toHaveLength(2200)
    for (const entry of presentation.entries) {
      expect(entry.radiusScreenPx * 2).toBeLessThan(.14 * scale)
      expect(entry.color).toBe('#C44230')
      expect(entry.symbol).toBe('square')
    }
    expect(JSON.stringify(plants)).toBe(before)
  })

  it('separates position marks in a planting spaced 27 cm apart at 50 percent zoom', () => {
    const plants = [
      createPlant({ id: 'a', position: { x: 0, y: 0 } }),
      createPlant({ id: 'b', position: { x: .27, y: 0 } }),
    ]
    const entries = buildPlantPresentationEntries(plants, {
      viewport: createViewport({ scale: 10 }), speciesCache: new Map(),
    }, new Set())
    expect(entries[0]!.radiusScreenPx).toBeCloseTo(1.134, 3)
    expect(entries[0]!.radiusScreenPx + entries[1]!.radiusScreenPx).toBeLessThan(2.7)
    expect(plants.map((plant) => plant.position)).toEqual([{ x: 0, y: 0 }, { x: .27, y: 0 }])
  })

  it('sizes default Plant Size Mode dots with a smooth absolute-scale Visual Footprint curve', () => {
    const expectedRadiiByScale = new Map([
      [1, 2.22],
      [5, 2.91],
      [10, 3.53],
      [50, 5.35],
      [200, 6.3],
    ])

    for (const [scale, expectedRadiusPx] of expectedRadiiByScale) {
      const entry = buildPlantPresentationEntries([createPlant()], {
        viewport: createViewport({ scale }),
        speciesCache: new Map(),
      }, new Set())[0]!

      expect(entry.radiusScreenPx).toBeCloseTo(expectedRadiusPx, 2)
    }
  })

  it('uses the resolved base color as the display color', () => {
    const plant = createPlant({ color: '#c44230' })
    const speciesCache = new Map([
      ['Malus domestica', {
        stratum: 'high',
      }],
    ])

    const presentation = buildPlantPresentationEntries([plant], {
      viewport: createViewport(),
      speciesCache,
    }, new Set())[0]!

    expect(presentation.baseColor).toBe('#C44230')
    expect(presentation.color).toBe('#C44230')
  })

  it('resolves Plant Symbols without changing the Visual Footprint', () => {
    const entries = buildPlantPresentationEntries([
      createPlant({ id: 'explicit', symbol: 'triangle' }),
      createPlant({ id: 'species-default', canonicalName: 'Pyrus communis' }),
      createPlant({ id: 'unknown', symbol: 'spiral' }),
    ], {
      viewport: createViewport(),
      speciesCache: new Map(),
      plantSpeciesSymbols: {
        'Pyrus communis': 'climber',
      },
    }, new Set())

    expect(entries.map((entry) => entry.symbol)).toEqual(['triangle', 'climber', 'round'])
    expect(entries.map((entry) => entry.radiusScreenPx)).toEqual([
      entries[0]!.radiusScreenPx,
      entries[0]!.radiusScreenPx,
      entries[0]!.radiusScreenPx,
    ])
  })

  it('keeps species canopy metadata out of the symbolic Visual Footprint', () => {
    const canopyPlant = createPlant({ id: 'canopy-plant', symbol: 'square' })
    const fallbackPlant = createPlant({ id: 'fallback-plant', canonicalName: 'Pyrus communis', symbol: 'triangle' })
    const speciesCache = new Map([
      ['Malus domestica', { width_max_m: 4 }],
    ])

    const canopyPresentation = buildPlantPresentationEntries([canopyPlant], {
      viewport: createViewport({ scale: 16 }),
      speciesCache,
    }, new Set())[0]!
    const fallbackPresentation = buildPlantPresentationEntries([fallbackPlant], {
      viewport: createViewport({ scale: 16 }),
      speciesCache,
    }, new Set())[0]!

    expect(canopyPresentation.radiusScreenPx).toBeCloseTo(4.05, 2)
    expect(canopyPresentation.radiusWorld).toBeCloseTo(4.05 / 16, 2)
    expect(canopyPresentation.usesCanopyRadius).toBe(false)
    expect(fallbackPresentation.radiusScreenPx).toBeCloseTo(4.05, 2)
    expect(fallbackPresentation.radiusWorld).toBeCloseTo(4.05 / 16, 2)
    expect(fallbackPresentation.usesCanopyRadius).toBe(false)
    expect(fallbackPresentation.symbol).toBe('triangle')
  })

  it('computes screen hit bounds from the resolved Visual Footprint plus interaction padding', () => {
    const plant = createPlant()
    const context = {
      viewport: createViewport({ x: 5, y: 7, scale: 8 }),
      speciesCache: new Map(),
    } as const
    const entry = buildPlantPresentationEntries([plant], context, new Set())[0]!
    const hitBounds = getPlantScreenHitBounds(plant, context)
    const expectedHitRadius = entry.radiusScreenPx + 4

    expect(hitBounds.center).toEqual({ x: 85, y: 167 })
    expect(hitBounds.radiusPx).toBeCloseTo(expectedHitRadius, 5)
    expect(hitBounds.bounds.x).toBeCloseTo(85 - expectedHitRadius, 5)
    expect(hitBounds.bounds.y).toBeCloseTo(167 - expectedHitRadius, 5)
    expect(hitBounds.bounds.width).toBeCloseTo(expectedHitRadius * 2, 5)
    expect(hitBounds.bounds.height).toBeCloseTo(expectedHitRadius * 2, 5)
  })

  it('reserves stack badges for coincident centres and anchors them to the highest-priority member', () => {
    const snapshot = buildPlantPresentationSnapshot([
      createPlant({ id: 'default', position: { x: 0, y: 0 } }),
      createPlant({ id: 'colored', position: { x: 0, y: 0 }, color: '#C44230' }),
      createPlant({ id: 'selected', position: { x: 0, y: 0 } }),
      createPlant({ id: 'nearby', position: { x: .27, y: 0 } }),
    ], {
      viewport: createViewport({ scale: 8 }),
      speciesCache: new Map(),
    }, new Set(['selected']))

    const badges = snapshot.stackBadges

    expect(badges).toHaveLength(1)
    expect(badges[0]).toMatchObject({
      anchorPlantId: 'selected',
      memberPlantIds: ['colored', 'default', 'selected'],
      count: 3,
      text: '3',
    })
  })

  it('anchors stack badge centers from the current Placed Plant Visual Footprint', () => {
    const snapshot = buildPlantPresentationSnapshot([
      createPlant({ id: 'plant-a', position: { x: 0, y: 0 } }),
      createPlant({ id: 'plant-b', position: { x: 0, y: 0 } }),
    ], {
      viewport: createViewport({ scale: 1 }),
      speciesCache: new Map(),
    }, new Set())

    expect(snapshot.stackBadges).toHaveLength(1)
    expect(snapshot.stackBadges[0]!.badgeCenterScreenPoint.x).toBeCloseTo(4.22, 2)
    expect(snapshot.stackBadges[0]!.badgeCenterScreenPoint.y).toBeCloseTo(-4.22, 2)
  })

  it('does not create stack badges for ordinary Visual Footprint overlap', () => {
    const snapshot = buildPlantPresentationSnapshot([
      createPlant({ id: 'plant-a', position: { x: 0, y: 0 } }),
      createPlant({ id: 'plant-b', position: { x: 0.12, y: 0 } }),
    ], {
      viewport: createViewport({ scale: 50 }),
      speciesCache: new Map(),
    }, new Set())

    expect(snapshot.stackBadges).toEqual([])
  })

  it('returns entries without label fields', () => {
    const entry = buildPlantPresentationEntries([createPlant()], {
      viewport: createViewport(),
      speciesCache: new Map(),
    }, new Set())[0]!

    expect(entry).toHaveProperty('radiusWorld')
    expect(entry).toHaveProperty('color')
    expect(entry).toHaveProperty('screenPoint')
    expect(entry).not.toHaveProperty('labelText')
    expect(entry).not.toHaveProperty('labelScreenPoint')
  })

  it('returns layout with only lod and stackCounts', () => {
    const snapshot = buildPlantPresentationSnapshot([createPlant()], {
      viewport: createViewport(),
      speciesCache: new Map(),
    }, new Set())

    expect(snapshot.layout).toHaveProperty('lod')
    expect(snapshot.layout).toHaveProperty('stackCounts')
    expect(snapshot.layout).not.toHaveProperty('visibleLabelIds')
  })
})
