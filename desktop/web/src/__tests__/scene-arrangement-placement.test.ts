import { describe, expect, it, vi } from 'vitest'
import {
  createSceneArrangementPlacement,
  type SceneArrangementTemplate,
} from '../canvas/runtime/scene-runtime/arrangement-placement'
import {
  cloneScenePersistedState,
  createDefaultScenePersistedState,
  type ScenePersistedState,
  type ScenePlantEntity,
  type SceneZoneEntity,
} from '../canvas/runtime/scene'
import type {
  SceneEditCoordinator,
  SceneEditTransaction,
} from '../canvas/runtime/scene-runtime/transactions'

describe('Scene Arrangement Placement', () => {
  it('places a mixed Group and ungrouped objects with typed remapping in one edit', () => {
    const destination = createDefaultScenePersistedState()
    destination.zones = [zone('Bed', 'rect', [{ x: 0, y: 0 }, { x: 2, y: 2 }])]
    const harness = createPlacementHarness(destination)
    const template = mixedTemplate()
    const originalTemplate = structuredClone(template)
    const ids = ['plant-clone', 'annotation-clone', 'guide-clone', 'group-clone']
    const placement = createSceneArrangementPlacement({
      sceneEdits: harness.sceneEdits,
      createId: () => ids.shift() ?? 'unexpected-id',
    })

    const receipt = placement.place({
      template,
      translateBy: { x: 10, y: 20 },
      historyType: 'test-arrangement',
    })

    const scene = harness.readScene()
    expect(receipt).toEqual({
      committed: true,
      createdCount: 6,
      selectedTopLevelIds: new Set([
        'group-clone',
        'Bed copy 2',
        'annotation-clone',
        'measurement-guide-guide-clone',
      ]),
    })
    expect(harness.runTypes).toEqual(['test-arrangement'])
    expect(scene.zones.map((entry) => entry.name)).toEqual(['Bed', 'Bed copy', 'Bed copy 2'])
    expect(scene.zones[1]?.points).toEqual([{ x: 15, y: 26 }, { x: 3, y: 4 }])
    expect(scene.zones[2]?.points).toEqual([{ x: 18, y: 29 }, { x: 20, y: 31 }])
    expect(scene.groups[0]).toMatchObject({
      id: 'group-clone',
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-clone' },
        { kind: 'zone', id: 'Bed copy' },
      ],
    })
    expect(template).toEqual(originalTemplate)
  })

  it('drops invalid Groups and selects their cloned members as top-level objects', () => {
    const harness = createPlacementHarness()
    const placement = createSceneArrangementPlacement({
      sceneEdits: harness.sceneEdits,
      createId: () => 'plant-clone',
    })
    const template: SceneArrangementTemplate = {
      plants: [{ sourceId: 'plant-source', entity: plant('plant-source', 1, 2) }],
      zones: [],
      annotations: [],
      measurementGuides: [],
      groups: [{
        sourceId: 'invalid-group',
        entity: {
          kind: 'group',
          id: 'invalid-group',
          locked: false,
          name: null,
          members: [
            { kind: 'plant', id: 'plant-source' },
            { kind: 'zone', id: 'missing-zone' },
          ],
        },
      }],
    }

    const receipt = placement.place({
      template,
      translateBy: { x: 0, y: 0 },
      historyType: 'invalid-group',
    })

    expect(harness.readScene().groups).toEqual([])
    expect(receipt.selectedTopLevelIds).toEqual(new Set(['plant-clone']))
  })

  it('does not count duplicate member references as a valid Group', () => {
    const harness = createPlacementHarness()
    const placement = createSceneArrangementPlacement({
      sceneEdits: harness.sceneEdits,
      createId: () => 'plant-clone',
    })
    const template: SceneArrangementTemplate = {
      ...emptyTemplate(),
      plants: [{ sourceId: 'plant-source', entity: plant('plant-source', 1, 2) }],
      groups: [{
        sourceId: 'duplicate-member-group',
        entity: {
          kind: 'group',
          id: 'duplicate-member-group',
          locked: false,
          name: null,
          members: [
            { kind: 'plant', id: 'plant-source' },
            { kind: 'plant', id: 'plant-source' },
          ],
        },
      }],
    }

    const receipt = placement.place({
      template,
      translateBy: { x: 0, y: 0 },
      historyType: 'duplicate-member-group',
    })

    expect(harness.readScene().groups).toEqual([])
    expect(receipt.selectedTopLevelIds).toEqual(new Set(['plant-clone']))
  })

  it('reuses an immutable template with fresh identities and Zone names', () => {
    const harness = createPlacementHarness()
    const ids = ['plant-1', 'plant-2']
    const placement = createSceneArrangementPlacement({
      sceneEdits: harness.sceneEdits,
      createId: () => ids.shift()!,
    })
    const template: SceneArrangementTemplate = {
      plants: [{ sourceId: 'plant-source', entity: plant('plant-source', 0, 0) }],
      zones: [{ sourceId: 'zone-source', entity: zone('Guild', 'ellipse', [{ x: 0, y: 0 }, { x: 2, y: 1 }]) }],
      annotations: [],
      measurementGuides: [],
      groups: [],
    }

    placement.place({ template, translateBy: { x: 1, y: 0 }, historyType: 'first' })
    placement.place({ template, translateBy: { x: 2, y: 0 }, historyType: 'second' })

    expect(harness.readScene().plants.map((entry) => entry.id)).toEqual(['plant-1', 'plant-2'])
    expect(harness.readScene().zones.map((entry) => entry.name)).toEqual(['Guild', 'Guild copy'])
    expect(template.plants[0]?.entity.id).toBe('plant-source')
    expect(template.zones[0]?.entity.name).toBe('Guild')
  })

  it('keeps Zone selection identities distinct from existing non-Zone identities', () => {
    const destination = createDefaultScenePersistedState()
    destination.plants = [plant('Guild', 0, 0)]
    const harness = createPlacementHarness(destination)
    const placement = createSceneArrangementPlacement({ sceneEdits: harness.sceneEdits })
    const template: SceneArrangementTemplate = {
      ...emptyTemplate(),
      zones: [{
        sourceId: 'saved-zone-id',
        entity: zone('Guild', 'rect', [{ x: 0, y: 0 }, { x: 2, y: 2 }]),
      }],
    }

    const receipt = placement.place({
      template,
      translateBy: { x: 0, y: 0 },
      historyType: 'cross-kind-collision',
    })

    expect(harness.readScene().zones[0]?.name).toBe('Guild copy')
    expect(receipt.selectedTopLevelIds).toEqual(new Set(['Guild copy']))
  })

  it('returns a non-committed receipt for an empty template', () => {
    const harness = createPlacementHarness()
    const placement = createSceneArrangementPlacement({ sceneEdits: harness.sceneEdits })

    const receipt = placement.place({
      template: emptyTemplate(),
      translateBy: { x: 5, y: 5 },
      historyType: 'empty',
    })

    expect(receipt).toEqual({
      committed: false,
      createdCount: 0,
      selectedTopLevelIds: new Set(),
    })
  })

  it('propagates allocation failures without partially inserting an arrangement', () => {
    const harness = createPlacementHarness()
    const createId = vi.fn(() => {
      if (createId.mock.calls.length === 1) return 'first-clone'
      throw new Error('identity allocation failed')
    })
    const placement = createSceneArrangementPlacement({ sceneEdits: harness.sceneEdits, createId })
    const template: SceneArrangementTemplate = {
      ...emptyTemplate(),
      plants: [
        { sourceId: 'plant-a', entity: plant('plant-a', 0, 0) },
        { sourceId: 'plant-b', entity: plant('plant-b', 1, 0) },
      ],
    }

    expect(() => placement.place({
      template,
      translateBy: { x: 0, y: 0 },
      historyType: 'failing',
    })).toThrow('identity allocation failed')
    expect(harness.readScene().plants).toEqual([])
  })
})

function createPlacementHarness(initial = createDefaultScenePersistedState()): {
  readonly sceneEdits: SceneEditCoordinator
  readonly runTypes: string[]
  readonly readScene: () => ScenePersistedState
} {
  let scene = cloneScenePersistedState(initial)
  let selection = new Set<string>()
  const runTypes: string[] = []

  const sceneEdits: SceneEditCoordinator = {
    run(type, edit) {
      runTypes.push(type)
      const before = cloneScenePersistedState(scene)
      const beforeSelection = new Set(selection)
      const tx = transaction(
        () => scene,
        (next) => { scene = next },
        (ids) => { selection = new Set(ids) },
      )
      try {
        edit(tx)
        return JSON.stringify(scene) !== JSON.stringify(before)
      } catch (error) {
        scene = before
        selection = beforeSelection
        throw error
      }
    },
    begin() {
      throw new Error('begin() is not used by Scene Arrangement Placement')
    },
  }

  return {
    sceneEdits,
    runTypes,
    readScene: () => cloneScenePersistedState(scene),
  }
}

function transaction(
  readScene: () => ScenePersistedState,
  writeScene: (scene: ScenePersistedState) => void,
  writeSelection: (ids: Iterable<string>) => void,
): SceneEditTransaction {
  return {
    mutate(edit) {
      const draft = cloneScenePersistedState(readScene())
      edit(draft)
      writeScene(draft)
    },
    setSelection: writeSelection,
    commit: () => true,
    abort: () => {},
    get changed() {
      return true
    },
  }
}

function mixedTemplate(): SceneArrangementTemplate {
  return {
    plants: [{ sourceId: 'plant-wire-id', entity: plant('plant-prototype', 1, 2) }],
    zones: [
      {
        sourceId: 'zone-wire-id',
        entity: zone('Bed', 'ellipse', [{ x: 5, y: 6 }, { x: 3, y: 4 }]),
      },
      {
        sourceId: 'ungrouped-zone-wire-id',
        entity: zone('Bed', 'rect', [{ x: 8, y: 9 }, { x: 10, y: 11 }]),
      },
    ],
    annotations: [{
      sourceId: 'annotation-wire-id',
      entity: {
        kind: 'annotation',
        id: 'annotation-prototype',
        locked: true,
        annotationType: 'text',
        position: { x: 2, y: 3 },
        text: 'Note',
        fontSize: 16,
        rotationDeg: null,
      },
    }],
    measurementGuides: [{
      sourceId: 'guide-wire-id',
      entity: {
        kind: 'measurement-guide',
        id: 'guide-prototype',
        locked: true,
        start: { x: 0, y: 0 },
        end: { x: 2, y: 2 },
      },
    }],
    groups: [{
      sourceId: 'group-wire-id',
      entity: {
        kind: 'group',
        id: 'group-prototype',
        locked: true,
        name: 'Mixed Group',
        members: [
          { kind: 'plant', id: 'plant-wire-id' },
          { kind: 'zone', id: 'zone-wire-id' },
        ],
      },
    }],
  }
}

function emptyTemplate(): SceneArrangementTemplate {
  return {
    plants: [],
    zones: [],
    annotations: [],
    measurementGuides: [],
    groups: [],
  }
}

function plant(id: string, x: number, y: number): ScenePlantEntity {
  return {
    kind: 'plant',
    id,
    locked: false,
    canonicalName: 'Malus domestica',
    commonName: 'Apple',
    color: null,
    symbol: null,
    pinnedName: false,
    stratum: null,
    canopySpreadM: null,
    position: { x, y },
    rotationDeg: null,
    scale: null,
    notes: null,
    plantedDate: null,
    quantity: null,
  }
}

function zone(
  name: string,
  zoneType: string,
  points: SceneZoneEntity['points'],
): SceneZoneEntity {
  return {
    kind: 'zone',
    name,
    locked: false,
    zoneType,
    points,
    rotationDeg: 0,
    fillColor: null,
    notes: null,
  }
}
