import { describe, expect, it, vi } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import type { CanvasQuerySurface } from '../canvas/runtime/runtime'
import { createSavedObjectStampWorkbench } from '../app/saved-object-stamps/workbench'
import type { SavedObjectStamp } from '../types/saved-object-stamps'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'

describe('Saved Object Stamp Workbench', () => {
  it('saves the current locked plant selection as an unlocked visible stamp payload', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = [{
      kind: 'plant',
      id: 'source-plant-9',
      locked: true,
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#c0442e',
      symbol: 'tree',
      stratum: null,
      canopySpreadM: null,
      position: { x: 12, y: 24 },
      rotationDeg: 15,
      scale: 2,
      notes: 'nursery note',
      plantedDate: '2026-04-01',
      quantity: 3,
    }]
    const query = {
      ...createTestCanvasQuerySurface({
        scene,
        localizedNames: new Map([['Malus domestica', 'Pommier']]),
      }),
      getDesignObjectSelection: () => ({
        editableTargets: [],
        lockedTargets: [{ kind: 'plant' as const, id: 'source-plant-9' }],
        blockedTargets: [],
        bounds: { minX: 10, minY: 20, maxX: 14, maxY: 28 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    } satisfies CanvasQuerySurface
    const createStamp = vi.fn(async (name: string, payloadJson: string): Promise<SavedObjectStamp> => ({
      id: 'stamp-1',
      name,
      payload_json: payloadJson,
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
    }))
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [],
      createSavedObjectStamp: createStamp,
      getCanvasQuerySurface: () => query,
    })

    const saved = await workbench.saveCurrentSelection()

    expect(saved?.name).toBe('Pommier')
    expect(createStamp).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(createStamp.mock.calls[0]![1])
    expect(payload.anchor).toEqual({ x: 12, y: 24 })
    expect(payload.plants).toEqual([{
      id: 'plant-1',
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#c0442e',
      symbol: 'tree',
      position: { x: 12, y: 24 },
      rotationDeg: 15,
      scale: 2,
    }])
    expect(payload.plants[0]).not.toHaveProperty('locked')
    expect(payload.plants[0]).not.toHaveProperty('notes')
    expect(payload.plants[0]).not.toHaveProperty('plantedDate')
    expect(payload.plants[0]).not.toHaveProperty('quantity')
  })

  it('does not save when the selection has structural blockers', async () => {
    const query = {
      ...createTestCanvasQuerySurface(),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'plant' as const, id: 'plant-1' }],
        lockedTargets: [],
        blockedTargets: [{
          target: { kind: 'zone' as const, id: 'Hidden zone' },
          reason: 'hidden-layer' as const,
          layerName: 'zones',
        }],
        bounds: null,
        sameSpeciesReferenceCanonicalName: null,
      }),
    } satisfies CanvasQuerySurface
    const createStamp = vi.fn()
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [],
      createSavedObjectStamp: createStamp,
      getCanvasQuerySurface: () => query,
    })

    const saved = await workbench.saveCurrentSelection()

    expect(saved).toBeNull()
    expect(workbench.selection.value).toMatchObject({
      canSave: false,
      reason: 'structural-blocker',
    })
    expect(createStamp).not.toHaveBeenCalled()
  })

  it('saves selected Object Groups with remapped visible members', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = [{
      kind: 'plant',
      id: 'source-plant',
      locked: false,
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: null,
      symbol: null,
      stratum: null,
      canopySpreadM: null,
      position: { x: 2, y: 3 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: null,
    }]
    scene.zones = [{
      kind: 'zone',
      name: 'Source zone',
      locked: true,
      zoneType: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }],
      rotationDeg: 10,
      fillColor: '#d8b35a',
      notes: 'mulch',
    }]
    scene.annotations = [{
      kind: 'annotation',
      id: 'source-note',
      locked: false,
      annotationType: 'text',
      position: { x: 6, y: 7 },
      text: 'Guild edge',
      fontSize: 14,
      rotationDeg: 5,
    }]
    scene.groups = [{
      kind: 'group',
      id: 'source-group',
      locked: true,
      name: 'Guild',
      members: [
        { kind: 'plant', id: 'source-plant' },
        { kind: 'zone', id: 'Source zone' },
        { kind: 'annotation', id: 'source-note' },
      ],
    }]
    const query = {
      ...createTestCanvasQuerySurface({ scene }),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'group' as const, id: 'source-group' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    } satisfies CanvasQuerySurface
    const createStamp = vi.fn(async (name: string, payloadJson: string): Promise<SavedObjectStamp> => ({
      id: 'stamp-2',
      name,
      payload_json: payloadJson,
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
    }))
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [],
      createSavedObjectStamp: createStamp,
      getCanvasQuerySurface: () => query,
    })

    await workbench.saveCurrentSelection()

    const payload = JSON.parse(createStamp.mock.calls[0]![1])
    expect(payload.zones[0]).not.toHaveProperty('locked')
    expect(payload.zones[0]).not.toHaveProperty('notes')
    expect(payload.groups).toEqual([{
      id: 'group-1',
      name: 'Guild',
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
        { kind: 'annotation', id: 'annotation-1' },
      ],
    }])
  })

  it('uses zone and annotation counts when a saved selection has no plants', async () => {
    const scene = createDefaultScenePersistedState()
    scene.zones = [{
      kind: 'zone',
      name: 'Water',
      locked: false,
      zoneType: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }],
      rotationDeg: 0,
      fillColor: null,
      notes: null,
    }]
    scene.annotations = [{
      kind: 'annotation',
      id: 'note-1',
      locked: false,
      annotationType: 'text',
      position: { x: 1, y: 1 },
      text: 'Irrigation',
      fontSize: 12,
      rotationDeg: null,
    }]
    const query = {
      ...createTestCanvasQuerySurface({ scene }),
      getDesignObjectSelection: () => ({
        editableTargets: [
          { kind: 'zone' as const, id: 'Water' },
          { kind: 'annotation' as const, id: 'note-1' },
        ],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    } satisfies CanvasQuerySurface
    const createStamp = vi.fn(async (name: string, payloadJson: string): Promise<SavedObjectStamp> => ({
      id: 'stamp-3',
      name,
      payload_json: payloadJson,
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
    }))
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [],
      createSavedObjectStamp: createStamp,
      getCanvasQuerySurface: () => query,
    })

    const saved = await workbench.saveCurrentSelection()

    expect(saved?.name).toBe('1 zone, 1 annotation')
  })
})
