import { describe, expect, it } from 'vitest'
import {
  createToolSceneSource,
  measurementGuide,
  plantEntity,
  rectZone,
  sceneStoreWith,
  textNote,
} from '../../../__tests__/support/tool-harness'
import { computeSelectionRect } from '../../operations'
import { hitTestTopLevel, hitTestVisibleTopLevel, queryRectTopLevel } from '../interaction/hit-testing'
import { buildPlantPresentationEntries } from '../plant-presentation'
import type { SceneStore } from '../scene'
import type { WorldPoint, WorldQuad } from '../view/types'
import { createToolScene } from './spatial-index'

function orchardStore(): SceneStore {
  return sceneStoreWith({
    plants: [
      plantEntity('p1', 'Malus domestica', { x: 0, y: 0 }, { commonName: 'Apple' }),
      plantEntity('p2', 'Pyrus communis', { x: 1, y: 0 }),
      plantEntity('p3', 'Prunus avium', { x: 20, y: 20 }),
      plantEntity('p4', 'Ficus carica', { x: 40, y: 40 }, { locked: true }),
    ],
    zones: [
      rectZone('z1', [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }]),
      rectZone('z2', [{ x: 18, y: 18 }, { x: 24, y: 18 }, { x: 24, y: 24 }, { x: 18, y: 24 }]),
    ],
    annotations: [textNote('a1', { x: 30, y: 0 }, 'Compost')],
    measurementGuides: [measurementGuide('m1', { x: 0, y: 30 }, { x: 10, y: 30 })],
    groups: [{
      kind: 'group',
      id: 'g1',
      locked: false,
      name: null,
      members: [{ kind: 'plant', id: 'p3' }, { kind: 'zone', id: 'z2' }],
    }],
  })
}

function samplePoints(): WorldPoint[] {
  const points: WorldPoint[] = []
  for (let x = -5; x <= 45; x += 1.25) {
    for (let y = -5; y <= 45; y += 1.25) points.push({ x, y })
  }
  return points
}

function quad(a: WorldPoint, b: WorldPoint): WorldQuad {
  return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }]
}

describe('ToolScene over today\'s hit tests', () => {
  it('hitAt with no filter is today\'s hitTestTopLevel exactly', () => {
    const store = orchardStore()
    store.setSelection([{ kind: 'annotation', id: 'a1' }])
    const source = createToolSceneSource(store, { pixelsPerMetre: () => 4 })
    const scene = createToolScene(source)

    for (const point of samplePoints()) {
      const expected = hitTestTopLevel(
        store.persisted,
        point,
        4,
        source.speciesCache(),
        source.plantContext,
        store.session.selectedTargets,
        store.session.hoveredTarget,
      )
      expect(scene.hitAt(point), `${point.x},${point.y}`).toEqual(expected ? { kind: 'object', target: expected } : null)
    }
    // Object locks are the caller's to reject: a locked plant is still hit.
    expect(scene.hitAt({ x: 40, y: 40 })).toEqual({ kind: 'object', target: { kind: 'plant', id: 'p4' } })
  })

  it('includeLocked is today\'s hitTestVisibleTopLevel, which the host\'s hover reads', () => {
    const store = orchardStore()
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => layer.name === 'plants' ? { ...layer, locked: true } : layer)
    })
    const source = createToolSceneSource(store, { pixelsPerMetre: () => 4 })
    const scene = createToolScene(source)

    expect(scene.hitAt({ x: 0, y: 0 })).toBeNull()
    for (const point of samplePoints()) {
      const expected = hitTestVisibleTopLevel(
        store.persisted,
        point,
        4,
        source.speciesCache(),
        source.plantContext,
        store.session.selectedTargets,
        store.session.hoveredTarget,
      )
      expect(scene.hitAt(point, { includeLocked: true }), `${point.x},${point.y}`)
        .toEqual(expected ? { kind: 'object', target: expected } : null)
    }
  })

  it('a kinds filter keeps only a top-level hit of those kinds', () => {
    const scene = createToolScene(createToolSceneSource(orchardStore(), { pixelsPerMetre: () => 4 }))

    expect(scene.hitAt({ x: 0, y: 0 }, { kinds: ['plant'] })).toEqual({ kind: 'object', target: { kind: 'plant', id: 'p1' } })
    // A grouped plant is hit as its group, which a plant filter refuses.
    expect(scene.hitAt({ x: 20, y: 20 }, { kinds: ['plant'] })).toBeNull()
    expect(scene.hitAt({ x: 20, y: 20 }, { kinds: ['group'] })).toEqual({ kind: 'object', target: { kind: 'group', id: 'g1' } })
  })

  it('reads the frame scale at every query, so screen-sized plants hit as drawn', () => {
    let pixelsPerMetre = 40
    const scene = createToolScene(createToolSceneSource(orchardStore(), { pixelsPerMetre: () => pixelsPerMetre }))
    // Between p1 and p2: at 40 px/m the symbols are small, at 4 px/m they cover the gap.
    const between = { x: 0.5, y: 0.3 }

    expect(scene.hitAt(between)).toBeNull()
    pixelsPerMetre = 4
    expect(scene.hitAt(between)).not.toBeNull()
  })

  it('refuses a screen tolerance until the zone-edge hits of phase 1 exist', () => {
    const scene = createToolScene(createToolSceneSource(orchardStore()))

    expect(() => scene.hitAt({ x: 0, y: 0 }, { toleranceScreenPx: 12 })).toThrow(/toleranceScreenPx/)
  })

  it('hitInQuad queries the quad\'s world bounds as today\'s band select does', () => {
    const store = orchardStore()
    const source = createToolSceneSource(store, { pixelsPerMetre: () => 4 })
    const scene = createToolScene(source)

    for (const [a, b] of [
      [{ x: -1, y: -1 }, { x: 6, y: 6 }],
      [{ x: 25, y: 25 }, { x: 16, y: -2 }],
      [{ x: -10, y: 28 }, { x: 50, y: 50 }],
    ] as const) {
      const expected = queryRectTopLevel(
        store.persisted,
        computeSelectionRect(a, b),
        4,
        source.speciesCache(),
        source.plantContext,
        store.session.selectedTargets,
      )
      expect(scene.hitInQuad(quad(a, b))).toEqual(expected.map((target) => ({ kind: 'object', target })))
    }
    expect(scene.hitInQuad(quad({ x: -1, y: -1 }, { x: 16, y: 16 }), { kinds: ['zone'] }))
      .toEqual([{ kind: 'object', target: { kind: 'zone', id: 'z1' } }])
  })

  it('nearestPlant orders by distance, then id, and skips excluded plants', () => {
    const store = sceneStoreWith({
      plants: [
        plantEntity('b', 'Malus domestica', { x: 3, y: 4 }),
        plantEntity('a', 'Malus domestica', { x: -3, y: -4 }),
        plantEntity('c', 'Malus domestica', { x: 10, y: 0 }),
      ],
    })
    const scene = createToolScene(createToolSceneSource(store))

    expect(scene.nearestPlant({ x: 0, y: 0 })).toEqual({ plant: store.persisted.plants[1], distanceM: 5 })
    expect(scene.nearestPlant({ x: 0, y: 0 }, new Set(['a']))).toEqual({ plant: store.persisted.plants[0], distanceM: 5 })
    expect(scene.nearestPlant({ x: 0, y: 0 }, new Set(['a', 'b', 'c']))).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => layer.name === 'plants' ? { ...layer, visible: false } : layer)
    })
    expect(scene.nearestPlant({ x: 0, y: 0 })).toBeNull()
  })

  it('names a plant in today\'s order and gives its display colour and symbol radius', () => {
    const store = orchardStore()
    const localizedCommonNames = new Map<string, string | null>([['Pyrus communis', 'Poirier']])
    const source = createToolSceneSource(store, { pixelsPerMetre: () => 4, localizedCommonNames })
    const scene = createToolScene(source)
    const [apple, pear] = store.persisted.plants
    const entries = buildPlantPresentationEntries(
      store.persisted.plants,
      { ...source.plantContext(4), plants: store.persisted.plants },
      new Set(),
    )

    expect(scene.plantPresentation(apple!)).toEqual({
      commonName: 'Apple',
      color: entries[0]!.color,
      radiusPx: entries[0]!.radiusScreenPx,
    })
    expect(scene.plantPresentation(pear!)?.commonName).toBe('Poirier')
    expect(scene.plantPresentation({ ...apple!, commonName: null })?.commonName).toBe('Malus domestica')
    expect(scene.plantPresentation('Pyrus communis')?.commonName).toBe('Poirier')
    expect(scene.plantPresentation('Sorbus domestica')).toMatchObject({ commonName: 'Sorbus domestica' })
    expect(scene.plantPresentation('')).toBeNull()
  })

  it('reads the scene, the selection and the selection model live', () => {
    const store = orchardStore()
    const source = createToolSceneSource(store, { pixelsPerMetre: () => 4 })
    const scene = createToolScene(source)

    expect(scene.selection()).toEqual([])
    expect(scene.selectionModel().editableTargets).toEqual([])
    store.setSelection([{ kind: 'zone', id: 'z1' }])
    expect(scene.selection()).toEqual([{ kind: 'zone', id: 'z1' }])
    expect(scene.selectionModel().editableTargets).toEqual([{ kind: 'zone', id: 'z1' }])

    store.updatePersisted((draft) => {
      draft.zones = []
    })
    expect(scene.persisted.zones).toEqual([])
    expect(scene.isLayerOpenForCreation('zones')).toBe(true)
  })
})
