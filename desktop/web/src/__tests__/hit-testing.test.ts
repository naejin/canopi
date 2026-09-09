import { describe, expect, it } from 'vitest'

import { hitTestTopLevel, hitTestVisibleTopLevel, queryRectTopLevel } from '../canvas/runtime/interaction/hit-testing'
import type { PlantPresentationContext } from '../canvas/runtime/plant-presentation'
import type { ScenePersistedState } from '../canvas/runtime/scene'

function createScene(): ScenePersistedState {
  return {
    plantSpeciesColors: {},
    plantSpeciesSymbols: {},
    layers: [
      { kind: 'layer', name: 'plants', visible: true, locked: false, opacity: 1 },
      { kind: 'layer', name: 'zones', visible: true, locked: false, opacity: 1 },
    ],
    plants: [{
      kind: 'plant',
      locked: false,
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
    }],
    zones: [],
    annotations: [],
    measurementGuides: [],
    groups: [],
    guides: [],
  }
}

function getPlantContext(viewportScale: number): PlantPresentationContext {
  return {
    viewport: { x: 0, y: 0, scale: viewportScale },
    speciesCache: new Map(),
  }
}

describe('scene hit testing', () => {
  it('keeps a crowded annotation discoverable without letting its hidden text steal a plant hit at working zoom', () => {
    const scene = createScene()
    scene.annotations = [{ kind: 'annotation', id: 'note', annotationType: 'text',
      position: { x: 0, y: 20 }, text: 'A long note over the plant', fontSize: 16, rotationDeg: null, locked: false }]
    expect(hitTestTopLevel(scene, { x: 10, y: 20 }, 20, new Map(), getPlantContext))
      .toEqual({ kind: 'plant', id: 'plant-1' })
    expect(hitTestTopLevel(scene, { x: 0, y: 20 }, 20, new Map(), getPlantContext))
      .toEqual({ kind: 'annotation', id: 'note' })
    expect(queryRectTopLevel(scene, { x: 5, y: 20, width: .1, height: .1 }, 20, new Map(), getPlantContext))
      .toEqual([])
    expect(hitTestTopLevel(scene, { x: 5, y: 20 }, 20, new Map(), getPlantContext, [], { kind: 'annotation', id: 'note' }))
      .toEqual({ kind: 'annotation', id: 'note' })
    expect(hitTestVisibleTopLevel(scene, { x: 5, y: 20 }, 20, new Map(), getPlantContext, [], { kind: 'annotation', id: 'note' }))
      .toEqual({ kind: 'annotation', id: 'note' })
  })

  it('chooses the closest visible plant when dense position marks share pointer padding', () => {
    const scene = createScene()
    scene.plants = [
      { ...scene.plants[0]!, id: 'a', position: { x: 0, y: 0 } },
      { ...scene.plants[0]!, id: 'b', position: { x: .27, y: 0 } },
    ]
    expect(hitTestTopLevel(scene, { x: 0, y: 0 }, 10, new Map(), getPlantContext))
      .toEqual({ kind: 'plant', id: 'a' })
    expect(queryRectTopLevel(scene, { x: -.3, y: 0, width: .01, height: .01 }, 10, new Map(), getPlantContext))
      .toEqual([])
  })

  it('hits the overview note marker without letting hidden text steal a plant hit', () => {
    const scene = createScene()
    scene.annotations = [{ kind: 'annotation', id: 'note', annotationType: 'text',
      position: { x: 0, y: 20 }, text: 'A long note over the plant', fontSize: 16, rotationDeg: null, locked: false }]
    expect(hitTestTopLevel(scene, { x: -6, y: 20 }, 1, new Map(), getPlantContext))
      .toEqual({ kind: 'annotation', id: 'note' })
    expect(hitTestTopLevel(scene, { x: 10, y: 20 }, 1, new Map(), getPlantContext))
      .toEqual({ kind: 'plant', id: 'plant-1' })
    expect(queryRectTopLevel(scene, { x: 30, y: 22, width: 2, height: 2 }, 1, new Map(), getPlantContext))
      .toEqual([])
  })

  it('uses the symbolic Placed Plant Visual Footprint for band selection bounds', () => {
    const scene = createScene()
    const targets = queryRectTopLevel(
      scene,
      { x: 10.34, y: 20, width: 0.01, height: 0.01 },
      10,
      new Map(),
      getPlantContext,
    )

    expect(targets).toEqual([{ kind: 'plant', id: 'plant-1' }])
  })

  it('detects visible locked-Layer targets for hover without making them editable', () => {
    const scene = createScene()
    scene.layers = [{ kind: 'layer', name: 'plants', visible: true, locked: true, opacity: 1 }]

    expect(hitTestTopLevel(scene, { x: 10, y: 20 }, 10, new Map(), getPlantContext))
      .toBeNull()
    expect(hitTestVisibleTopLevel(scene, { x: 10, y: 20 }, 10, new Map(), getPlantContext))
      .toEqual({ kind: 'plant', id: 'plant-1' })
  })

  it('hides hidden-Layer targets from editable and hover hit testing', () => {
    const scene = createScene()
    scene.layers = [{ kind: 'layer', name: 'plants', visible: false, locked: false, opacity: 1 }]

    expect(hitTestTopLevel(scene, { x: 10, y: 20 }, 10, new Map(), getPlantContext))
      .toBeNull()
    expect(hitTestVisibleTopLevel(scene, { x: 10, y: 20 }, 10, new Map(), getPlantContext))
      .toBeNull()
  })

  it('hit-tests rotated Rectangular Zones by oriented boundary proximity', () => {
    const scene = createScene()
    scene.plants = []
    scene.zones = [{
      kind: 'zone',
      name: 'zone-1',
      locked: false,
      zoneType: 'rect',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 0, y: 4 },
      ],
      rotationDeg: 45,
      fillColor: null,
      notes: null,
    }]

    expect(hitTestTopLevel(scene, { x: 6.4, y: 0.6 }, 10, new Map(), getPlantContext))
      .toEqual({ kind: 'zone', id: 'zone-1' })
    expect(hitTestTopLevel(scene, { x: 5, y: 2 }, 10, new Map(), getPlantContext))
      .toBeNull()
    expect(hitTestTopLevel(scene, { x: -5, y: -5 }, 10, new Map(), getPlantContext))
      .toBeNull()
  })

  it('band-selects rotated Rectangular Zones by their oriented geometry', () => {
    const scene = createScene()
    scene.plants = []
    scene.zones = [{
      kind: 'zone',
      name: 'zone-1',
      locked: false,
      zoneType: 'rect',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 0, y: 4 },
      ],
      rotationDeg: 45,
      fillColor: null,
      notes: null,
    }]

    expect(queryRectTopLevel(scene, { x: 5, y: 2, width: 0.01, height: 0.01 }, 1, new Map(), getPlantContext))
      .toEqual([{ kind: 'zone', id: 'zone-1' }])
    expect(queryRectTopLevel(scene, { x: 1, y: 1, width: 0.01, height: 0.01 }, 1, new Map(), getPlantContext))
      .toEqual([])
  })

  it('hit-tests rotated Elliptical Zones by oriented boundary proximity', () => {
    const scene = createScene()
    scene.plants = []
    scene.zones = [{
      kind: 'zone',
      name: 'zone-1',
      locked: false,
      zoneType: 'ellipse',
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 1 },
      ],
      rotationDeg: 90,
      fillColor: null,
      notes: null,
    }]

    expect(hitTestTopLevel(scene, { x: 0, y: 4 }, 10, new Map(), getPlantContext))
      .toEqual({ kind: 'zone', id: 'zone-1' })
    expect(hitTestTopLevel(scene, { x: 0, y: 0 }, 10, new Map(), getPlantContext))
      .toBeNull()
    expect(hitTestTopLevel(scene, { x: 3, y: 0 }, 10, new Map(), getPlantContext))
      .toBeNull()
  })

  it('keeps large Elliptical Zone boundary hits screen-stable at high zoom', () => {
    const scene = createScene()
    scene.plants = []
    scene.zones = [{
      kind: 'zone',
      name: 'zone-1',
      locked: false,
      zoneType: 'ellipse',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      rotationDeg: 0,
      fillColor: null,
      notes: null,
    }]
    const midpointBetweenFixedSamplesRad = (3.75 * Math.PI) / 180

    expect(hitTestTopLevel(
      scene,
      {
        x: Math.cos(midpointBetweenFixedSamplesRad) * 100,
        y: Math.sin(midpointBetweenFixedSamplesRad) * 100,
      },
      100,
      new Map(),
      getPlantContext,
    )).toEqual({ kind: 'zone', id: 'zone-1' })
  })

  it('band-selects rotated Elliptical Zones by their oriented geometry', () => {
    const scene = createScene()
    scene.plants = []
    scene.zones = [{
      kind: 'zone',
      name: 'zone-1',
      locked: false,
      zoneType: 'ellipse',
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 1 },
      ],
      rotationDeg: 90,
      fillColor: null,
      notes: null,
    }]

    expect(queryRectTopLevel(scene, { x: 0, y: 3, width: 0.01, height: 0.01 }, 1, new Map(), getPlantContext))
      .toEqual([{ kind: 'zone', id: 'zone-1' }])
    expect(queryRectTopLevel(scene, { x: 3, y: 0, width: 0.01, height: 0.01 }, 1, new Map(), getPlantContext))
      .toEqual([])
  })

  it('hit-tests selected rotated text annotations by their oriented text geometry', () => {
    const scene = createScene()
    scene.plants = []
    scene.annotations = [{
      kind: 'annotation',
      id: 'annotation-1',
      locked: false,
      annotationType: 'text',
      position: { x: 10, y: 20 },
      text: 'ABCD',
      fontSize: 10,
      rotationDeg: 90,
    }]

    expect(hitTestTopLevel(scene, { x: 0, y: 30 }, 1, new Map(), getPlantContext, [{ kind: 'annotation', id: 'annotation-1' }]))
      .toEqual({ kind: 'annotation', id: 'annotation-1' })
    expect(hitTestTopLevel(scene, { x: 20, y: 25 }, 1, new Map(), getPlantContext, [{ kind: 'annotation', id: 'annotation-1' }]))
      .toBeNull()
    expect(queryRectTopLevel(scene, { x: 0, y: 30, width: 0.01, height: 0.01 }, 1, new Map(), getPlantContext, [{ kind: 'annotation', id: 'annotation-1' }]))
      .toEqual([{ kind: 'annotation', id: 'annotation-1' }])
    expect(queryRectTopLevel(scene, { x: 20, y: 25, width: 0.01, height: 0.01 }, 1, new Map(), getPlantContext, [{ kind: 'annotation', id: 'annotation-1' }]))
      .toEqual([])
  })

  it('band-selects revealed rotated text annotations by their oriented geometry instead of empty AABB corners', () => {
    const scene = createScene()
    scene.plants = []
    scene.annotations = [{
      kind: 'annotation',
      id: 'annotation-1',
      locked: false,
      annotationType: 'text',
      position: { x: 0, y: 0 },
      text: 'ABCD',
      fontSize: 10,
      rotationDeg: 45,
    }]

    expect(hitTestTopLevel(scene, { x: 16, y: 2 }, 1, new Map(), getPlantContext, [{ kind: 'annotation', id: 'annotation-1' }]))
      .toBeNull()
    expect(queryRectTopLevel(scene, { x: 16, y: 2, width: 0.01, height: 0.01 }, 1, new Map(), getPlantContext, [{ kind: 'annotation', id: 'annotation-1' }]))
      .toEqual([])
    expect(queryRectTopLevel(scene, { x: 8, y: 8, width: 0.01, height: 0.01 }, 1, new Map(), getPlantContext, [{ kind: 'annotation', id: 'annotation-1' }]))
      .toEqual([{ kind: 'annotation', id: 'annotation-1' }])
  })
})
