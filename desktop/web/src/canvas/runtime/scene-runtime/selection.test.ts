import { describe, expect, it } from 'vitest'

import {
  createDefaultScenePersistedState,
  type SceneDesignObjectTarget,
  type ScenePersistedState,
} from '../scene'
import { getDesignObjectSelectionModel, projectSceneSelectionEntityIds } from './selection'

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
        rotationDeg: 0,
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
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'zone-1' },
        ],
      },
    ],
  }
}

function readModel(scene: ScenePersistedState, selectedTargets: readonly SceneDesignObjectTarget[]) {
  return getDesignObjectSelectionModel(scene, selectedTargets, {
    annotationViewportScale: 1,
    plantContext: {
      viewport: { x: 0, y: 0, scale: 1 },
      speciesCache: new Map(),
      localizedCommonNames: new Map(),
    },
  })
}

describe('scene design object selection model', () => {
  it('projects large typed selections with a linear entity scan', () => {
    const scene = makeScene()
    const plantCount = 100
    let idReads = 0
    scene.groups = []
    scene.plants = Array.from({ length: plantCount }, (_, index) => {
      const id = `plant-${index}`
      const plant = {
        ...scene.plants[0]!,
        id,
      }
      Object.defineProperty(plant, 'id', {
        configurable: true,
        enumerable: true,
        get: () => {
          idReads += 1
          return id
        },
      })
      return plant
    })

    const projected = projectSceneSelectionEntityIds(
      scene,
      Array.from({ length: plantCount }, (_, index) => ({
        kind: 'plant' as const,
        id: `plant-${index}`,
      })),
    )

    expect(projected.selectedPlantIds.size).toBe(plantCount)
    expect(idReads).toBeLessThanOrEqual(plantCount * 3)
  })

  it('preserves intended kinds for missing selected targets with colliding raw ids', () => {
    const model = readModel(makeScene(), [
      { kind: 'annotation', id: 'missing-shared' },
      { kind: 'zone', id: 'missing-shared' },
    ])

    expect(model.blockedTargets).toEqual([
      {
        target: { kind: 'annotation', id: 'missing-shared' },
        reason: 'missing-design-object',
        layerName: null,
      },
      {
        target: { kind: 'zone', id: 'missing-shared' },
        reason: 'missing-design-object',
        layerName: null,
      },
    ])
  })

  it('keeps grouped members out of editable top-level selection', () => {
    const model = readModel(makeScene(), [
      { kind: 'group', id: 'group-1' },
      { kind: 'plant', id: 'plant-1' },
    ])

    expect(model.editableTargets).toEqual([{ kind: 'group', id: 'group-1' }])
    expect(model.blockedTargets).toContainEqual({
      target: { kind: 'plant', id: 'plant-1' },
      reason: 'grouped-member',
      layerName: 'plants',
      groupId: 'group-1',
    })
  })

  it('reports directly locked Design Objects as selected locked targets with bounds', () => {
    const model = readModel(makeScene(), [{ kind: 'plant', id: 'plant-2' }])

    expect(model.editableTargets).toEqual([])
    expect(model.lockedTargets).toEqual([{ kind: 'plant', id: 'plant-2' }])
    expect(model.blockedTargets).toEqual([{
      target: { kind: 'plant', id: 'plant-2' },
      reason: 'locked-design-object',
      layerName: 'plants',
    }])
    expect(model.bounds?.minX).toBeLessThan(30)
    expect(model.bounds?.minY).toBeLessThan(30)
    expect(model.bounds?.maxX).toBeGreaterThan(30)
    expect(model.bounds?.maxY).toBeGreaterThan(30)
  })

  it('uses plant Visual Footprint bounds for selected plants', () => {
    const scene = makeScene()
    scene.groups = []
    scene.plants = scene.plants.filter((plant) => plant.id === 'plant-1')

    const model = readModel(scene, [{ kind: 'plant', id: 'plant-1' }])

    expect(model.editableTargets).toEqual([{ kind: 'plant', id: 'plant-1' }])
    expect(model.bounds?.minX).toBeLessThan(10)
    expect(model.bounds?.minY).toBeLessThan(10)
    expect(model.bounds?.maxX).toBeGreaterThan(10)
    expect(model.bounds?.maxY).toBeGreaterThan(10)
  })

  it('uses oriented Zone geometry for selected Zone bounds', () => {
    const scene = makeScene()
    scene.groups = []
    scene.zones[0] = {
      ...scene.zones[0]!,
      rotationDeg: 90,
    }

    const model = readModel(scene, [{ kind: 'zone', id: 'zone-1' }])

    expect(model.bounds?.minX).toBeCloseTo(1)
    expect(model.bounds?.minY).toBeCloseTo(-1)
    expect(model.bounds?.maxX).toBeCloseTo(7)
    expect(model.bounds?.maxY).toBeCloseTo(7)
  })

  it('uses rotated annotation readable bounds for selected Annotation bounds', () => {
    const scene = makeScene()
    scene.groups = []
    scene.annotations[0] = {
      ...scene.annotations[0]!,
      position: { x: 10, y: 20 },
      text: 'ABCD',
      fontSize: 10,
      rotationDeg: 90,
    }

    const model = readModel(scene, [{ kind: 'annotation', id: 'annotation-1' }])

    expect(model.bounds?.minX).toBeCloseTo(-2.5)
    expect(model.bounds?.minY).toBeCloseTo(20)
    expect(model.bounds?.maxX).toBeCloseTo(10)
    expect(model.bounds?.maxY).toBeCloseTo(44)
  })

  it('reports hidden Layer selections without editable bounds', () => {
    const scene = makeScene()
    scene.groups = []
    scene.layers = scene.layers.map((layer) =>
      layer.name === 'zones' ? { ...layer, visible: false } : layer,
    )

    const model = readModel(scene, [{ kind: 'zone', id: 'zone-1' }])

    expect(model.editableTargets).toEqual([])
    expect(model.blockedTargets).toEqual([{
      target: { kind: 'zone', id: 'zone-1' },
      reason: 'hidden-layer',
      layerName: 'zones',
    }])
    expect(model.bounds).toBeNull()
  })

  it('reports a same-Species reference only for clear editable plant selections', () => {
    const scene = makeScene()
    scene.groups = []

    expect(readModel(scene, [{ kind: 'plant', id: 'plant-1' }]).sameSpeciesReferenceCanonicalName)
      .toBe('Malus domestica')

    scene.plants[1] = {
      ...scene.plants[1]!,
      locked: false,
    }
    expect(readModel(scene, [
      { kind: 'plant', id: 'plant-1' },
      { kind: 'plant', id: 'plant-2' },
    ]).sameSpeciesReferenceCanonicalName)
      .toBeNull()
    expect(readModel(scene, [
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'zone-1' },
    ]).sameSpeciesReferenceCanonicalName)
      .toBeNull()
  })

  it('combines Object Group member geometry and annotation readable bounds', () => {
    const model = readModel(makeScene(), [
      { kind: 'group', id: 'group-1' },
      { kind: 'annotation', id: 'annotation-1' },
    ])

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

  it('blocks a cross-Layer Object Group when any member Layer is hidden', () => {
    const scene = makeScene()
    scene.layers = scene.layers.map((layer) =>
      layer.name === 'zones' ? { ...layer, visible: false } : layer,
    )

    const groupModel = readModel(scene, [{ kind: 'group', id: 'group-1' }])
    expect(groupModel.editableTargets).toEqual([])
    expect(groupModel.blockedTargets).toEqual([{
      target: { kind: 'group', id: 'group-1' },
      reason: 'hidden-layer',
      layerName: 'zones',
    }])
    expect(groupModel.bounds).toBeNull()

    const visibleMemberModel = readModel(scene, [{ kind: 'plant', id: 'plant-1' }])
    expect(visibleMemberModel.editableTargets).toEqual([])
    expect(visibleMemberModel.blockedTargets).toEqual([{
      target: { kind: 'plant', id: 'plant-1' },
      reason: 'grouped-member',
      layerName: 'plants',
      groupId: 'group-1',
    }])
  })

  it('treats an Object Group on a locked member Layer as a structural blocker', () => {
    const scene = makeScene()
    scene.layers = scene.layers.map((layer) =>
      layer.name === 'zones' ? { ...layer, locked: true } : layer,
    )

    const model = readModel(scene, [{ kind: 'group', id: 'group-1' }])

    expect(model.editableTargets).toEqual([])
    expect(model.lockedTargets).toEqual([])
    expect(model.blockedTargets).toEqual([{
      target: { kind: 'group', id: 'group-1' },
      reason: 'locked-layer',
      layerName: 'zones',
    }])
  })
})
