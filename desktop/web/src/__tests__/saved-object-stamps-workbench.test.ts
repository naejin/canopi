import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import type { CanvasRuntimeSavedObjectStampCapture } from '../canvas/runtime/app-adapter'
import type { CanvasQuerySurface } from '../canvas/runtime/runtime'
import { createSavedObjectStampWorkbench } from '../app/saved-object-stamps/workbench'
import type { CanopiFile } from '../types/design'
import type { SavedObjectStamp } from '../types/saved-object-stamps'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { setCanvasRuntimeSurfaces } from '../canvas/session'
import { setCanvasSelection } from '../canvas/session-state'

describe('Saved Object Stamp Workbench', () => {
  afterEach(() => {
    setCanvasRuntimeSurfaces(null)
    setCanvasSelection([])
  })

  const makeStamp = (id: string, name: string, sortOrder: number): SavedObjectStamp => ({
    id,
    name,
    payload_json: JSON.stringify({ plants: [], zones: [], annotations: [], groups: [] }),
    sort_order: sortOrder,
    created_at: `2026-06-19T09:00:0${sortOrder}Z`,
    updated_at: `2026-06-19T09:00:0${sortOrder}Z`,
  })

  const captureFromQuery = (query: CanvasQuerySurface): CanvasRuntimeSavedObjectStampCapture => ({
    scene: query.getSceneSnapshot(),
    selection: query.getDesignObjectSelection(),
    localizedCommonNames: query.getLocalizedCommonNames(),
  })

  it('saves the admitted canvas capture when the mounted canvas has changed', async () => {
    const admittedScene = createDefaultScenePersistedState()
    admittedScene.annotations = [{
      kind: 'annotation',
      id: 'admitted-note',
      locked: false,
      annotationType: 'text',
      position: { x: 2, y: 3 },
      text: 'Runtime A',
      fontSize: 12,
      rotationDeg: null,
    }]
    const admittedQuery = {
      ...createTestCanvasQuerySurface({ scene: admittedScene }),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'annotation' as const, id: 'admitted-note' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 2, minY: 3, maxX: 2, maxY: 3 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    } satisfies CanvasQuerySurface

    const mountedScene = createDefaultScenePersistedState()
    mountedScene.annotations = [{
      kind: 'annotation',
      id: 'mounted-note',
      locked: false,
      annotationType: 'text',
      position: { x: 8, y: 9 },
      text: 'Runtime B',
      fontSize: 12,
      rotationDeg: null,
    }]
    const mountedQuery = {
      ...createTestCanvasQuerySurface({ scene: mountedScene }),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'annotation' as const, id: 'mounted-note' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 8, minY: 9, maxX: 8, maxY: 9 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    } satisfies CanvasQuerySurface
    const createStamp = vi.fn(async (name: string, payloadJson: string): Promise<SavedObjectStamp> => ({
      id: 'stamp-capture',
      name,
      payload_json: payloadJson,
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
    }))
    const getMountedQuery = vi.fn(() => mountedQuery)
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [],
      createSavedObjectStamp: createStamp,
      getCanvasQuerySurface: getMountedQuery,
    })

    await workbench.saveSelection(captureFromQuery(admittedQuery))

    expect(getMountedQuery).not.toHaveBeenCalled()
    const payload = JSON.parse(createStamp.mock.calls[0]![1])
    expect(payload.annotations).toEqual([
      expect.objectContaining({ text: 'Runtime A' }),
    ])
  })

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
        blockedTargets: [{
          target: { kind: 'plant' as const, id: 'source-plant-9' },
          reason: 'locked-design-object' as const,
          layerName: 'plants',
        }],
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

    const saved = await workbench.saveSelection(captureFromQuery(query))

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

  it('captures the effective Plant Symbol inherited from species defaults', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plantSpeciesSymbols = { 'Malus domestica': 'tree' }
    scene.plants = [{
      kind: 'plant',
      id: 'source-plant-default-symbol',
      locked: false,
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: null,
      symbol: null,
      stratum: null,
      canopySpreadM: null,
      position: { x: 4, y: 5 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: null,
    }]
    const query = {
      ...createTestCanvasQuerySurface({ scene }),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'plant' as const, id: 'source-plant-default-symbol' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 3, minY: 4, maxX: 5, maxY: 6 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    } satisfies CanvasQuerySurface
    const createStamp = vi.fn(async (name: string, payloadJson: string): Promise<SavedObjectStamp> => ({
      id: 'stamp-symbol',
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

    await workbench.saveSelection(captureFromQuery(query))

    const payload = JSON.parse(createStamp.mock.calls[0]![1])
    expect(payload.plants[0].symbol).toBe('tree')
  })

  it('updates selection availability when the canvas selection changes without a scene edit', () => {
    let selectedIds = new Set<string>()
    const query = {
      ...createTestCanvasQuerySurface(),
      getSelection: () => new Set(selectedIds),
      getDesignObjectSelection: () => selectedIds.size === 0
        ? {
            editableTargets: [],
            lockedTargets: [],
            blockedTargets: [],
            bounds: null,
            sameSpeciesReferenceCanonicalName: null,
          }
        : {
            editableTargets: [{ kind: 'plant' as const, id: 'plant-1' }],
            lockedTargets: [],
            blockedTargets: [],
            bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
            sameSpeciesReferenceCanonicalName: null,
          },
    } satisfies CanvasQuerySurface
    setCanvasRuntimeSurfaces({
      queries: query,
      commands: {} as never,
      documents: {} as never,
    })
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [],
      getCanvasQuerySurface: undefined,
    })

    expect(workbench.selection.value.canSave).toBe(false)

    selectedIds = new Set(['plant-1'])
    setCanvasSelection(selectedIds)

    expect(workbench.selection.value.canSave).toBe(true)
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

    const saved = await workbench.saveSelection(captureFromQuery(query))

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

    await workbench.saveSelection(captureFromQuery(query))

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

    const saved = await workbench.saveSelection(captureFromQuery(query))

    expect(saved?.name).toBe('1 zone, 1 annotation')
  })

  it('renames deletes and reorders saved stamps through the library adapters', async () => {
    const first = makeStamp('stamp-1', 'First', 0)
    const second = makeStamp('stamp-2', 'Second', 1)
    let persistedFirst = first
    const renameStamp = vi.fn(async (id: string, name: string): Promise<SavedObjectStamp> => {
      persistedFirst = {
        ...persistedFirst,
        id,
        name,
        updated_at: '2026-06-19T10:00:00Z',
      }
      return persistedFirst
    })
    const deleteStamp = vi.fn(async () => true)
    const reorderStamps = vi.fn(async (ids: string[]): Promise<SavedObjectStamp[]> => (
      ids.map((id, index) => ({
        ...(id === first.id ? persistedFirst : second),
        sort_order: index,
      }))
    ))
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [first, second],
      createSavedObjectStamp: async () => first,
      renameSavedObjectStamp: renameStamp,
      deleteSavedObjectStamp: deleteStamp,
      reorderSavedObjectStamps: reorderStamps,
      getCanvasQuerySurface: () => null,
    })

    await workbench.loadLibrary()
    await workbench.renameStamp('stamp-1', 'Renamed')
    await workbench.reorderStamps(['stamp-2', 'stamp-1'])
    await workbench.deleteStamp('stamp-2')

    expect(renameStamp).toHaveBeenCalledWith('stamp-1', 'Renamed')
    expect(reorderStamps).toHaveBeenCalledWith(['stamp-2', 'stamp-1'])
    expect(deleteStamp).toHaveBeenCalledWith('stamp-2')
    expect(workbench.library.value.items.map((stamp) => stamp.name)).toEqual(['Renamed'])
  })

  it('arms placement through the canvas placement adapter', () => {
    const stamp = makeStamp('stamp-1', 'Guild', 0)
    const beginPlacement = vi.fn(() => true)
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [stamp],
      createSavedObjectStamp: async () => stamp,
      getCanvasQuerySurface: () => null,
      beginPlacement,
    })

    expect(workbench.placeStamp(stamp)).toBe(true)
    expect(beginPlacement).toHaveBeenCalledWith(stamp)
  })

  it('exports a saved stamp as a Canopi file without touching the Design Session', async () => {
    const stamp: SavedObjectStamp = {
      id: 'stamp-1',
      name: 'Apple guild',
      payload_json: JSON.stringify({
        version: 1,
        anchor: { x: 0, y: 0 },
        plants: [{
          id: 'plant-1',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          symbol: null,
          position: { x: 0, y: 0 },
          rotationDeg: null,
          scale: null,
        }],
        zones: [],
        annotations: [],
        groups: [],
      }),
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
    }
    const exportSavedObjectStamp = vi.fn(async (
      _file: CanopiFile,
      _defaultName: string,
    ): Promise<string> => '/tmp/Apple guild.canopi')
    const getCanvasQuerySurface = vi.fn(() => {
      throw new Error('Design Session should not be read during export')
    })
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [stamp],
      createSavedObjectStamp: async () => stamp,
      exportSavedObjectStamp,
      getCanvasQuerySurface,
    })

    const path = await workbench.exportStamp(stamp)

    expect(path).toBe('/tmp/Apple guild.canopi')
    expect(getCanvasQuerySurface).not.toHaveBeenCalled()
    expect(exportSavedObjectStamp).toHaveBeenCalledTimes(1)
    const [file, defaultName] = exportSavedObjectStamp.mock.calls[0]!
    expect(defaultName).toBe('Apple guild.canopi')
    expect(file).toMatchObject({
      name: 'Apple guild',
      location: null,
      description: null,
      plants: [{
        id: 'plant-1',
        locked: false,
        canonical_name: 'Malus domestica',
        notes: null,
        planted_date: null,
        quantity: null,
      }],
      consortiums: [],
      timeline: [],
      budget: [],
    })
  })

  it('imports a Canopi file as a saved stamp without touching the Design Session', async () => {
    const file: CanopiFile = {
      version: 3,
      name: 'Imported design',
      description: 'Ignored description',
      location: { lat: 45, lon: 3, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      plant_species_symbols: {},
      layers: [{ name: 'plants', visible: true, locked: true, opacity: 1 }],
      plants: [{
        id: 'source-plant',
        locked: true,
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        symbol: null,
        position: { x: 2, y: 3 },
        rotation: null,
        scale: null,
        notes: 'private note',
        planted_date: '2026-04-01',
        quantity: 4,
      }],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      budget_currency: 'USD',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
      extra: { guides: [{ axis: 'h', position: 10 }] },
    }
    const importSavedObjectStampFile = vi.fn(async (): Promise<CanopiFile> => file)
    const createStamp = vi.fn(async (name: string, payloadJson: string): Promise<SavedObjectStamp> => ({
      id: 'stamp-imported',
      name,
      payload_json: payloadJson,
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
    }))
    const getCanvasQuerySurface = vi.fn(() => {
      throw new Error('Design Session should not be read during import')
    })
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [],
      createSavedObjectStamp: createStamp,
      importSavedObjectStampFile,
      getCanvasQuerySurface,
    })

    const saved = await workbench.importStampFile()

    expect(saved?.name).toBe('Imported design')
    expect(getCanvasQuerySurface).not.toHaveBeenCalled()
    expect(createStamp).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(createStamp.mock.calls[0]![1])
    expect(payload).toMatchObject({
      version: 1,
      anchor: { x: 2, y: 3 },
      plants: [{
        id: 'source-plant',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
      }],
      zones: [],
      annotations: [],
      groups: [],
    })
    expect(payload.plants[0]).not.toHaveProperty('locked')
    expect(payload.plants[0]).not.toHaveProperty('notes')
    expect(payload.plants[0]).not.toHaveProperty('plantedDate')
    expect(payload.plants[0]).not.toHaveProperty('quantity')
    expect(workbench.library.value.items).toEqual([saved])
  })

  it('does not create a saved stamp from an empty Canopi import', async () => {
    const importSavedObjectStampFile = vi.fn(async (): Promise<CanopiFile> => ({
      version: 3,
      name: 'Empty design',
      description: null,
      location: null,
      north_bearing_deg: 0,
      plant_species_colors: {},
      plant_species_symbols: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
      extra: {},
    }))
    const createStamp = vi.fn()
    const workbench = createSavedObjectStampWorkbench({
      getSavedObjectStamps: async () => [],
      createSavedObjectStamp: createStamp,
      importSavedObjectStampFile,
      getCanvasQuerySurface: () => null,
    })

    const saved = await workbench.importStampFile()

    expect(saved).toBeNull()
    expect(createStamp).not.toHaveBeenCalled()
  })
})
