import { describe, expect, it } from 'vitest'
import type { ScenePlantEntity } from '../canvas/runtime/scene'
import {
  buildPlantPresentationEntries,
  getStackBadgeSizePx,
  STACK_BADGE_FONT_SIZE_PX,
  hitTestPlant,
  layoutPlantPresentation,
  resolveStackBadgeDecisions,
  type PlantPresentationContext,
} from '../canvas/runtime/plant-presentation'
import { createTestRendererView } from './support/scene-renderer-snapshot'
import { getStratumColor } from '../canvas/plants'

/** The renderer's composition: entries, then layout and stack badges from them. */
function buildPlantPresentationSnapshot(
  plants: readonly ScenePlantEntity[],
  context: PlantPresentationContext,
  selectedPlantIds: ReadonlySet<string>,
) {
  const entries = buildPlantPresentationEntries(plants, context, selectedPlantIds)
  return {
    entries,
    layout: layoutPlantPresentation(entries, context.pixelsPerMetre),
    stackBadges: resolveStackBadgeDecisions(entries),
  }
}

function createPlant(overrides: Partial<ScenePlantEntity> = {}): ScenePlantEntity {
  return {
    kind: 'plant' as const,
    id: 'plant-1',
    canonicalName: 'Malus domestica',
    commonName: 'Apple',
    color: null,
    canopySpreadM: null,
    position: { x: 10, y: 20 },
    rotationDeg: null,
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
      color: '#c44230', symbol: 'rosette',
    }))
    const before = JSON.stringify(plants)
    const presentation = buildPlantPresentationSnapshot(plants, {
      pixelsPerMetre: scale, speciesCache: new Map(),
    }, new Set())
    expect(presentation.stackBadges).toHaveLength(0)
    expect(presentation.entries).toHaveLength(2200)
    for (const entry of presentation.entries) {
      expect(entry.radiusScreenPx * 2).toBeLessThan(.14 * scale)
      expect(entry.color).toBe('#C44230')
      expect(entry.symbol).toBe('rosette')
    }
    expect(JSON.stringify(plants)).toBe(before)
  })

  it('separates position marks in a planting spaced 27 cm apart at 50 percent zoom', () => {
    const plants = [
      createPlant({ id: 'a', position: { x: 0, y: 0 } }),
      createPlant({ id: 'b', position: { x: .27, y: 0 } }),
    ]
    const entries = buildPlantPresentationEntries(plants, {
      pixelsPerMetre: 10, speciesCache: new Map(),
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
        pixelsPerMetre: scale,
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
      pixelsPerMetre: 8,
      speciesCache,
    }, new Set())[0]!

    expect(presentation.baseColor).toBe('#C44230')
    expect(presentation.color).toBe('#C44230')
  })

  it('a plant without its own colour takes its stratum colour from the species cache', () => {
    const presentation = buildPlantPresentationEntries([createPlant()], {
      pixelsPerMetre: 8,
      speciesCache: new Map([['Malus domestica', { stratum: 'emergent' }]]),
    }, new Set())[0]!

    expect(presentation.baseColor).toBe(getStratumColor('emergent'))
  })

  it('resolves Plant Symbols without changing the Visual Footprint', () => {
    const entries = buildPlantPresentationEntries([
      createPlant({ id: 'explicit', symbol: 'conifer' }),
      createPlant({ id: 'species-default', canonicalName: 'Pyrus communis' }),
      createPlant({ id: 'unknown', symbol: 'spiral' }),
    ], {
      pixelsPerMetre: 8,
      speciesCache: new Map(),
      plantSpeciesSymbols: {
        'Pyrus communis': 'climber',
      },
    }, new Set())

    expect(entries.map((entry) => entry.symbol)).toEqual(['conifer', 'climber', 'round'])
    expect(entries.map((entry) => entry.radiusScreenPx)).toEqual([
      entries[0]!.radiusScreenPx,
      entries[0]!.radiusScreenPx,
      entries[0]!.radiusScreenPx,
    ])
  })

  it('keeps species canopy metadata out of the symbolic Visual Footprint', () => {
    const canopyPlant = createPlant({ id: 'canopy-plant', symbol: 'rosette' })
    const fallbackPlant = createPlant({ id: 'fallback-plant', canonicalName: 'Pyrus communis', symbol: 'conifer' })
    const speciesCache = new Map([
      ['Malus domestica', { width_max_m: 4 }],
    ])

    const canopyPresentation = buildPlantPresentationEntries([canopyPlant], {
      pixelsPerMetre: 16,
      speciesCache,
    }, new Set())[0]!
    const fallbackPresentation = buildPlantPresentationEntries([fallbackPlant], {
      pixelsPerMetre: 16,
      speciesCache,
    }, new Set())[0]!

    expect(canopyPresentation.radiusScreenPx).toBeCloseTo(4.05, 2)
    expect(canopyPresentation.radiusWorld).toBeCloseTo(4.05 / 16, 2)
    expect(fallbackPresentation.radiusScreenPx).toBeCloseTo(4.05, 2)
    expect(fallbackPresentation.radiusWorld).toBeCloseTo(4.05 / 16, 2)
    expect(fallbackPresentation.symbol).toBe('conifer')
  })

  it('hit tests the resolved Visual Footprint plus interaction padding', () => {
    const plant = createPlant()
    const context = {
      pixelsPerMetre: 8,
      speciesCache: new Map(),
    } as const
    const entry = buildPlantPresentationEntries([plant], context, new Set())[0]!
    const hitRadiusMetres = (entry.radiusScreenPx + 4) / context.pixelsPerMetre
    const at = (distance: number) => ({ x: plant.position.x + distance, y: plant.position.y })

    expect(hitTestPlant(plant, at(hitRadiusMetres * 0.999), context)).toBe(true)
    expect(hitTestPlant(plant, at(hitRadiusMetres * 1.001), context)).toBe(false)
  })

  it('reserves stack badges for coincident centres and anchors them to the highest-priority member', () => {
    const snapshot = buildPlantPresentationSnapshot([
      createPlant({ id: 'default', position: { x: 0, y: 0 } }),
      createPlant({ id: 'colored', position: { x: 0, y: 0 }, color: '#C44230' }),
      createPlant({ id: 'selected', position: { x: 0, y: 0 } }),
      createPlant({ id: 'nearby', position: { x: .27, y: 0 } }),
    ], {
      pixelsPerMetre: 8,
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
      pixelsPerMetre: 1,
      speciesCache: new Map(),
    }, new Set())

    expect(snapshot.stackBadges).toHaveLength(1)
    // The badge's centre in the frame: its anchor's projection plus its offset.
    const badge = snapshot.stackBadges[0]!
    const anchor = createTestRendererView({ x: 0, y: 0, scale: 1 }).worldToScreen(badge.anchor)
    expect(anchor.x + badge.badgeOffsetPx.x).toBeCloseTo(4.22, 2)
    expect(anchor.y + badge.badgeOffsetPx.y).toBeCloseTo(-4.22, 2)
  })

  it('does not create stack badges for ordinary Visual Footprint overlap', () => {
    const snapshot = buildPlantPresentationSnapshot([
      createPlant({ id: 'plant-a', position: { x: 0, y: 0 } }),
      createPlant({ id: 'plant-b', position: { x: 0.12, y: 0 } }),
    ], {
      pixelsPerMetre: 50,
      speciesCache: new Map(),
    }, new Set())

    expect(snapshot.stackBadges).toEqual([])
  })

  it('returns entries without label fields', () => {
    const entry = buildPlantPresentationEntries([createPlant()], {
      pixelsPerMetre: 8,
      speciesCache: new Map(),
    }, new Set())[0]!

    expect(entry).toHaveProperty('radiusWorld')
    expect(entry).toHaveProperty('color')
    expect(entry).not.toHaveProperty('screenPoint')
    expect(entry).not.toHaveProperty('labelText')
    expect(entry).not.toHaveProperty('labelScreenPoint')
  })

  it('returns layout with only lod and stackCounts', () => {
    const snapshot = buildPlantPresentationSnapshot([createPlant()], {
      pixelsPerMetre: 8,
      speciesCache: new Map(),
    }, new Set())

    expect(snapshot.layout).toHaveProperty('lod')
    expect(snapshot.layout).toHaveProperty('stackCounts')
    expect(snapshot.layout).not.toHaveProperty('visibleLabelIds')
  })
})

describe('stack badge size', () => {
  it('fits the count at the 12 px floor, a circle for one digit and a pill for more', () => {
    expect(STACK_BADGE_FONT_SIZE_PX).toBeGreaterThanOrEqual(12)
    expect(getStackBadgeSizePx('2')).toEqual({ width: 18, height: 18 })
    const two = getStackBadgeSizePx('12')
    const three = getStackBadgeSizePx('120')
    expect(two.width).toBeGreaterThanOrEqual(2 * 0.6 * STACK_BADGE_FONT_SIZE_PX + 6)
    expect(three.width).toBeGreaterThan(two.width)
    expect(three.width).toBeGreaterThanOrEqual(3 * 0.6 * STACK_BADGE_FONT_SIZE_PX + 6)
  })
})
