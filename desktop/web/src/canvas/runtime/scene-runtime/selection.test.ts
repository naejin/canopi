import { describe, expect, it } from 'vitest'

import {
  createDefaultScenePersistedState,
  type ScenePersistedState,
} from '../scene'
import { getDesignObjectSelectionModel } from './selection'

function makeScene(): ScenePersistedState {
  return {
    ...createDefaultScenePersistedState(),
    plants: [
      {
        kind: 'plant',
        id: 'plant-1',
        locked: false,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: null,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        scale: null,
        notes: null,
        plantedDate: null,
        quantity: null,
      },
      {
        kind: 'plant',
        id: 'plant-2',
        locked: true,
        canonicalName: 'Pyrus communis',
        commonName: 'Pear',
        color: null,
        stratum: null,
        canopySpreadM: null,
        position: { x: 30, y: 30 },
        rotationDeg: null,
        scale: null,
        notes: null,
        plantedDate: null,
        quantity: null,
      },
    ],
    zones: [
      {
        kind: 'zone',
        name: 'zone-1',
        locked: false,
        zoneType: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 8, y: 6 },
          { x: 0, y: 6 },
        ],
        fillColor: null,
        notes: null,
      },
    ],
    annotations: [
      {
        kind: 'annotation',
        id: 'annotation-1',
        locked: false,
        annotationType: 'text',
        position: { x: 50, y: 60 },
        text: 'Note',
        fontSize: 20,
        rotationDeg: null,
      },
    ],
    groups: [
      {
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: null,
        layer: 'plants',
        position: { x: 10, y: 10 },
        rotationDeg: null,
        memberIds: ['plant-1', 'zone-1'],
      },
    ],
  }
}

function readModel(scene: ScenePersistedState, selectedIds: readonly string[]) {
  return getDesignObjectSelectionModel(scene, new Set(selectedIds), {
    annotationViewportScale: 1,
    plantContext: {
      viewport: { x: 0, y: 0, scale: 1 },
      sizeMode: 'default',
      colorByAttr: null,
      speciesCache: new Map(),
      localizedCommonNames: new Map(),
    },
  })
}

describe('scene design object selection model', () => {
  it('keeps grouped members out of editable top-level selection', () => {
    const model = readModel(makeScene(), ['group-1', 'plant-1'])

    expect(model.editableTargets).toEqual([{ kind: 'group', id: 'group-1' }])
    expect(model.blockedTargets).toContainEqual({
      target: { kind: 'plant', id: 'plant-1' },
      reason: 'grouped-member',
      layerName: 'plants',
      groupId: 'group-1',
    })
  })

  it('reports directly locked Design Objects without making them editable', () => {
    const model = readModel(makeScene(), ['plant-2'])

    expect(model.editableTargets).toEqual([])
    expect(model.blockedTargets).toEqual([{
      target: { kind: 'plant', id: 'plant-2' },
      reason: 'locked-design-object',
      layerName: 'plants',
    }])
    expect(model.bounds).toBeNull()
  })

  it('uses plant Visual Footprint bounds for selected plants', () => {
    const scene = makeScene()
    scene.groups = []
    scene.plants = scene.plants.filter((plant) => plant.id === 'plant-1')

    const model = readModel(scene, ['plant-1'])

    expect(model.editableTargets).toEqual([{ kind: 'plant', id: 'plant-1' }])
    expect(model.bounds?.minX).toBeLessThan(10)
    expect(model.bounds?.minY).toBeLessThan(10)
    expect(model.bounds?.maxX).toBeGreaterThan(10)
    expect(model.bounds?.maxY).toBeGreaterThan(10)
  })

  it('reports hidden Layer selections without editable bounds', () => {
    const scene = makeScene()
    scene.groups = []
    scene.layers = scene.layers.map((layer) =>
      layer.name === 'zones' ? { ...layer, visible: false } : layer,
    )

    const model = readModel(scene, ['zone-1'])

    expect(model.editableTargets).toEqual([])
    expect(model.blockedTargets).toEqual([{
      target: { kind: 'zone', id: 'zone-1' },
      reason: 'hidden-layer',
      layerName: 'zones',
    }])
    expect(model.bounds).toBeNull()
  })

  it('combines Object Group member geometry and annotation readable bounds', () => {
    const model = readModel(makeScene(), ['group-1', 'annotation-1'])

    expect(model.editableTargets).toEqual([
      { kind: 'group', id: 'group-1' },
      { kind: 'annotation', id: 'annotation-1' },
    ])
    expect(model.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 98,
      maxY: 85,
    })
  })
})
