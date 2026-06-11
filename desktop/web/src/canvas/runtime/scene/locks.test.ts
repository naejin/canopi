import { describe, expect, it } from 'vitest'

import {
  createDefaultScenePersistedState,
  isSceneDesignObjectLocked,
  type ScenePersistedState,
} from './index'

function sceneWithGroup(): ScenePersistedState {
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
    ],
    zones: [
      {
        kind: 'zone',
        name: 'zone-1',
        locked: false,
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
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
        position: { x: 20, y: 20 },
        text: 'Note',
        fontSize: 16,
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
        position: { x: 0, y: 0 },
        rotationDeg: null,
        memberIds: ['plant-1', 'zone-1', 'annotation-1', 'missing-member'],
      },
    ],
  }
}

describe('scene design object locks', () => {
  it('treats a group as unlocked when all existing members are unlocked or missing', () => {
    const scene = sceneWithGroup()

    expect(isSceneDesignObjectLocked(scene, 'group-1')).toBe(false)
  })

  it.each([
    ['plant member', 'plant-1'],
    ['zone member', 'zone-1'],
    ['annotation member', 'annotation-1'],
  ] as const)('treats a group as locked when its %s is locked', (_label, id) => {
    const scene = sceneWithGroup()
    lockMember(scene, id)

    expect(isSceneDesignObjectLocked(scene, 'group-1')).toBe(true)
  })

  it('treats a directly locked group as locked when members are unlocked', () => {
    const scene = sceneWithGroup()
    scene.groups = scene.groups.map((group) =>
      group.id === 'group-1' ? { ...group, locked: true } : group,
    )

    expect(isSceneDesignObjectLocked(scene, 'group-1')).toBe(true)
  })
})

function lockMember(scene: ScenePersistedState, id: string): void {
  scene.plants = scene.plants.map((plant) =>
    plant.id === id ? { ...plant, locked: true } : plant,
  )
  scene.zones = scene.zones.map((zone) =>
    zone.name === id ? { ...zone, locked: true } : zone,
  )
  scene.annotations = scene.annotations.map((annotation) =>
    annotation.id === id ? { ...annotation, locked: true } : annotation,
  )
}
