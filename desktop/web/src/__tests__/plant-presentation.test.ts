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
  }
}

describe('plant presentation service', () => {
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

  it('matches canopy sizing from species detail and uses zoom-reference fallback when missing', () => {
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
    expect(fallbackPresentation.radiusWorld).toBe(1)
    expect(fallbackPresentation.radiusScreenPx).toBe(16)
  })

  it('computes screen hit bounds from the resolved radius', () => {
    const hitBounds = getPlantScreenHitBounds(createPlant(), {
      viewport: createViewport({ x: 5, y: 7, scale: 8 }),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
      speciesCache: new Map(),
    })

    expect(hitBounds.center).toEqual({ x: 85, y: 167 })
    expect(hitBounds.radiusPx).toBe(12)
    expect(hitBounds.bounds).toEqual({
      x: 73,
      y: 155,
      width: 24,
      height: 24,
    })
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
