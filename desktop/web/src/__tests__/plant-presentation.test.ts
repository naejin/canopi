import { describe, expect, it } from 'vitest'
import type { ScenePlantEntity, SceneViewportState } from '../canvas/runtime/scene'
import {
  buildPlantPresentationEntries,
  buildPlantPresentationSnapshot,
  getPlantScreenHitBounds,
  plantPresentationService,
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
        zoomReference: 8,
        sizeMode: 'default',
        colorByAttr: null,
        speciesCache: new Map(),
      }, new Set())[0]!

      expect(entry.radiusScreenPx).toBeCloseTo(expectedRadiusPx, 2)
    }
  })

  it('keeps override precedence for base color while allowing color-by display color', () => {
    const plant = createPlant({ color: '#c44230' })
    const speciesCache = new Map([
      ['Malus domestica', {
        stratum: 'high',
        hardiness_zone_min: 7,
      }],
    ])

    const basePresentation = buildPlantPresentationEntries([plant], {
      viewport: createViewport(),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
      speciesCache,
    }, new Set())[0]!
    const colorByPresentation = buildPlantPresentationEntries([plant], {
      viewport: createViewport(),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: 'hardiness',
      speciesCache,
    }, new Set())[0]!

    expect(basePresentation.baseColor).toBe('#C44230')
    expect(basePresentation.color).toBe('#C44230')
    expect(colorByPresentation.baseColor).toBe('#C44230')
    expect(colorByPresentation.color).toBe('#8BC34A')
  })

  it('matches canopy sizing from species detail and uses symbolic fallback when missing', () => {
    const canopyPlant = createPlant({ id: 'canopy-plant' })
    const fallbackPlant = createPlant({ id: 'fallback-plant', canonicalName: 'Pyrus communis' })
    const speciesCache = new Map([
      ['Malus domestica', { width_max_m: 4 }],
    ])

    const canopyPresentation = buildPlantPresentationEntries([canopyPlant], {
      viewport: createViewport({ scale: 16 }),
      zoomReference: 8,
      sizeMode: 'canopy',
      colorByAttr: null,
      speciesCache,
    }, new Set())[0]!
    const fallbackPresentation = buildPlantPresentationEntries([fallbackPlant], {
      viewport: createViewport({ scale: 16 }),
      zoomReference: 8,
      sizeMode: 'canopy',
      colorByAttr: null,
      speciesCache,
    }, new Set())[0]!

    expect(canopyPresentation.radiusWorld).toBe(2)
    expect(canopyPresentation.radiusScreenPx).toBe(32)
    expect(fallbackPresentation.radiusScreenPx).toBeCloseTo(4.05, 2)
    expect(fallbackPresentation.radiusWorld).toBeCloseTo(4.05 / 16, 2)
  })

  it('computes screen hit bounds from the resolved Visual Footprint plus interaction padding', () => {
    const plant = createPlant()
    const context = {
      viewport: createViewport({ x: 5, y: 7, scale: 8 }),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
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

  it('clusters stack badges transitively and anchors them to the highest-priority member', () => {
    const snapshot = buildPlantPresentationSnapshot([
      createPlant({ id: 'default', position: { x: 0, y: 0 } }),
      createPlant({ id: 'colored', position: { x: 0.375, y: 0 }, color: '#C44230' }),
      createPlant({ id: 'selected', position: { x: 0.75, y: 0 } }),
    ], {
      viewport: createViewport({ scale: 8 }),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
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
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
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
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
      speciesCache: new Map(),
    }, new Set())

    expect(snapshot.stackBadges).toEqual([])
  })

  it('resolves color-by attributes from normalized species detail', () => {
    const color = plantPresentationService.resolveDisplayColor(
      createPlant(),
      'flower',
      new Map([['Malus domestica', { resolved_flower_color: 'Yellow' }]]),
    )

    expect(color).toBe('#C8A51E')
  })

  it('returns entries without label fields', () => {
    const entry = buildPlantPresentationEntries([createPlant()], {
      viewport: createViewport(),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
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
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
      speciesCache: new Map(),
    }, new Set())

    expect(snapshot.layout).toHaveProperty('lod')
    expect(snapshot.layout).toHaveProperty('stackCounts')
    expect(snapshot.layout).not.toHaveProperty('visibleLabelIds')
  })
})
