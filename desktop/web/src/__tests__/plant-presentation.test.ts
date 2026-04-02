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

  it('derives label text, style, and selected priority from presentation state', () => {
    const plant = createPlant({
      commonName: null,
      canonicalName: 'Lavandula angustifolia',
    })

    const presentation = buildPlantPresentationEntries([plant], {
      viewport: createViewport({ scale: 1 }),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
      speciesCache: new Map(),
    }, new Set(['plant-1']))[0]!

    expect(presentation.labelText).toBe('L. ang.')
    expect(presentation.labelFontStyle).toBe('italic')
    expect(presentation.labelPriority).toBe(0)
    expect(presentation.labelVisibleAtCurrentLod).toBe(true)
    expect(presentation.lod).toBe('icon')
  })

  it('prefers localized common-name overrides without mutating persisted plant data', () => {
    const plant = createPlant({
      commonName: 'Apple',
      canonicalName: 'Malus domestica',
    })

    const presentation = buildPlantPresentationEntries([plant], {
      viewport: createViewport({ scale: 1 }),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
      speciesCache: new Map(),
      localizedCommonNames: new Map([['Malus domestica', 'Pommier']]),
    }, new Set())[0]!

    expect(plant.commonName).toBe('Apple')
    expect(presentation.labelText).toBe('Pommier')
    expect(presentation.labelFontStyle).toBe('normal')
  })

  it('prefers selected and user-colored plants during density suppression', () => {
    const snapshot = buildPlantPresentationSnapshot([
      createPlant({ id: 'default', position: { x: 0, y: 0 } }),
      createPlant({ id: 'colored', position: { x: 1.25, y: 1.25 }, color: '#C44230' }),
      createPlant({ id: 'selected', position: { x: 5, y: 5 } }),
    ], {
      viewport: createViewport({ scale: 8 }),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
      speciesCache: new Map(),
    }, new Set(['selected']))

    expect(snapshot.layout.visibleLabelIds.has('default')).toBe(false)
    expect(snapshot.layout.visibleLabelIds.has('colored')).toBe(true)
    expect(snapshot.layout.visibleLabelIds.has('selected')).toBe(true)
  })

  it('keeps differently colored neighbors visible when only the relaxed threshold would apply', () => {
    const snapshot = buildPlantPresentationSnapshot([
      createPlant({ id: 'green', position: { x: 0, y: 0 } }),
      createPlant({ id: 'red', position: { x: 3.75, y: 0 }, color: '#C44230' }),
    ], {
      viewport: createViewport({ scale: 8 }),
      zoomReference: 8,
      sizeMode: 'default',
      colorByAttr: null,
      speciesCache: new Map(),
    }, new Set())

    expect(snapshot.layout.visibleLabelIds.has('green')).toBe(true)
    expect(snapshot.layout.visibleLabelIds.has('red')).toBe(true)
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
})
