import { describe, expect, it } from 'vitest'

import type { CanopiFile } from '../../../types/design'
import { SceneStore } from '../scene'
import { SceneRuntimeMutationController } from './mutations'
import { SceneRuntimeEditCoordinator } from './transactions'

function makeFile(): CanopiFile {
  return {
    version: 1,
    name: 'Mutation demo',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    layers: [
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
      { name: 'annotations', visible: true, locked: false, opacity: 1 },
    ],
    plants: [
      {
        id: 'plant-1',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: { x: 10, y: 10 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
      {
        id: 'plant-2',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: { x: 20, y: 20 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
    ],
    zones: [
      {
        name: 'zone-1',
        zone_type: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        fill_color: null,
        notes: null,
        locked: false,
      },
    ],
    annotations: [
      {
        id: 'annotation-1',
        annotation_type: 'text',
        position: { x: 50, y: 60 },
        text: 'Note',
        font_size: 20,
        rotation: null,
        locked: false,
      },
    ],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-04-02T00:00:00.000Z',
    updated_at: '2026-04-02T00:00:00.000Z',
    extra: {},
  }
}

function createController(file = makeFile()) {
  const sceneStore = new SceneStore(file)
  const state = {
    invalidations: 0,
    dirtyTypes: [] as string[],
    presentationSyncs: 0,
    plantSpeciesColorSyncs: 0,
  }
  const captureSnapshot = () => {
    const snapshot = sceneStore.snapshot()
    return {
      persisted: snapshot.persisted,
      session: snapshot.session,
    }
  }
  const setSelection = (ids: Iterable<string>) => {
    sceneStore.setSelection(ids)
  }
  const sceneEdits = new SceneRuntimeEditCoordinator({
    sceneStore,
    captureSnapshot,
    markDirty: (_before, type) => {
      state.dirtyTypes.push(type ?? 'scene-mutation')
      return true
    },
    setSelection,
    invalidate: (kind) => {
      if (kind === 'scene') state.invalidations += 1
    },
  })
  const controller = new SceneRuntimeMutationController({
    sceneStore,
    selection: {
      set: setSelection,
    },
    sceneEdits,
    presentation: {
      syncSignals: () => {
        state.presentationSyncs += 1
      },
      syncPlantSpeciesColors: () => {
        state.plantSpeciesColorSyncs += 1
      },
      getViewportScale: () => 1,
      createPlantPresentationContext: (viewportScale = 1) => ({
        viewport: { x: 0, y: 0, scale: viewportScale },
        sizeMode: 'default',
        colorByAttr: null,
        speciesCache: new Map(),
        localizedCommonNames: new Map(),
      }),
      getSuggestedPlantColor: (canonicalName) => canonicalName === 'Malus domestica' ? '#C44230' : null,
    },
    invalidateScene: () => {
      state.invalidations += 1
    },
  })

  return { controller, sceneStore, state }
}

describe('scene runtime mutation controller', () => {
  it('deletes selected groups with embedded locks', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
    )
    file.groups = [
      {
        id: 'group-1',
        name: null,
        layer: 'plants',
        position: { x: 10, y: 10 },
        rotation: null,
        member_ids: ['plant-1', 'plant-2'],
        locked: true,
      },
    ]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection(['group-1'])

    controller.deleteSelected()

    expect(sceneStore.persisted.groups).toEqual([])
    expect(sceneStore.persisted.plants).toEqual([])
    expect(sceneStore.session.selectedEntityIds.size).toBe(0)
    expect(state.dirtyTypes).toEqual(['delete-selected'])
    expect(state.invalidations).toBe(1)
  })

  it('selectAll skips grouped members and locked entities', () => {
    const file = makeFile()
    file.groups = [
      {
        id: 'group-1',
        name: null,
        layer: 'plants',
        position: { x: 10, y: 10 },
        rotation: null,
        member_ids: ['plant-1', 'plant-2'],
        locked: false,
      },
    ]
    file.zones = file.zones.map((zone) =>
      zone.name === 'zone-1' ? { ...zone, locked: true } : zone,
    )
    const { controller, sceneStore, state } = createController(file)

    controller.selectAll()

    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['group-1', 'annotation-1']))
    expect(state.invalidations).toBe(1)
  })

  it('selectAll reads layer visibility from the scene store', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'annotations' ? { ...layer, visible: false } : layer,
    )
    const { controller, sceneStore } = createController(file)

    controller.selectAll()

    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['plant-1', 'plant-2', 'zone-1']))
  })

  it('updates species colors through the presentation seam', () => {
    const { controller, sceneStore, state } = createController()

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(2)
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
    expect(state.invalidations).toBe(1)
  })
})
