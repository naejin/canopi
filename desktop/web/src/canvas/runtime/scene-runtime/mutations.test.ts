import { describe, expect, it } from 'vitest'

import type { CanopiFile } from '../../../types/design'
import { resolvePlantSymbolForPlant, SceneStore } from '../scene'
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
        rotation: 0,
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
      getLocalizedCommonNames: () => new Map(),
      getSuggestedPlantColor: (canonicalName) => canonicalName === 'Malus domestica' ? '#C44230' : null,
    },
    invalidateScene: () => {
      state.invalidations += 1
    },
  })

  return { controller, sceneStore, state }
}

describe('scene runtime mutation controller', () => {
  it('does not delete selected groups that contain locked members', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
    )
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
      },
    ]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection(['group-1'])

    controller.deleteSelected()

    expect(sceneStore.persisted.groups).toHaveLength(1)
    expect(sceneStore.persisted.plants).toHaveLength(2)
    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['group-1']))
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('does not ungroup or reorder selected groups that contain locked members', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
    )
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
      },
      {
        id: 'group-2',
        name: null,
        locked: false,
        members: [{ kind: 'plant', id: 'missing-member' }],
      },
    ]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection(['group-1'])

    controller.ungroupSelected()
    controller.bringToFront()
    controller.sendToBack()

    expect(sceneStore.persisted.groups.map((group) => group.id)).toEqual(['group-1', 'group-2'])
    expect(sceneStore.persisted.plants).toHaveLength(2)
    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['group-1']))
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('does not duplicate selected groups that contain locked members', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
    )
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
      },
    ]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection(['group-1'])

    controller.duplicateSelected()

    expect(sceneStore.persisted.groups).toHaveLength(1)
    expect(sceneStore.persisted.plants).toHaveLength(2)
    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['group-1']))
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('does not delete a selected Design Object after its Layer becomes locked', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'zones' ? { ...layer, locked: true } : layer,
    )
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection(['zone-1'])

    controller.deleteSelected()

    expect(sceneStore.persisted.zones.map((zone) => zone.name)).toEqual(['zone-1'])
    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['zone-1']))
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('selectAll skips grouped members and locked entities', () => {
    const file = makeFile()
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
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

  it('selectAll skips groups that contain locked members', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
    )
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
      },
    ]
    const { controller, sceneStore, state } = createController(file)

    controller.selectAll()

    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['zone-1', 'annotation-1']))
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

  it('selectAll skips Design Objects on locked Layers', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'plants' ? { ...layer, locked: true } : layer,
    )
    const { controller, sceneStore } = createController(file)

    controller.selectAll()

    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['zone-1', 'annotation-1']))
  })

  it('groups mixed concrete Design Objects into typed Object Group members', () => {
    const { controller, sceneStore, state } = createController()
    sceneStore.setSelection(['plant-1', 'zone-1', 'annotation-1'])

    controller.groupSelected()

    expect(sceneStore.persisted.groups).toHaveLength(1)
    const group = sceneStore.persisted.groups[0]!
    expect(group.members).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'zone-1' },
      { kind: 'annotation', id: 'annotation-1' },
    ])
    expect(sceneStore.session.selectedEntityIds).toEqual(new Set([group.id]))
    expect(state.dirtyTypes).toEqual(['group-selected'])
  })

  it('flattens one selected Object Group into its existing identity when grouping with another object', () => {
    const file = makeFile()
    file.groups = [{
      id: 'group-1',
      name: 'Guild',
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
      ],
    }]
    const { controller, sceneStore } = createController(file)
    sceneStore.setSelection(['group-1', 'annotation-1'])

    controller.groupSelected()

    expect(sceneStore.persisted.groups).toEqual([{
      kind: 'group',
      id: 'group-1',
      name: 'Guild',
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
        { kind: 'annotation', id: 'annotation-1' },
      ],
    }])
    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['group-1']))
  })

  it('merges multiple selected Object Groups into the topmost selected group', () => {
    const file = makeFile()
    file.groups = [
      {
        id: 'group-low',
        name: 'Low',
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'zone-1' },
        ],
      },
      {
        id: 'group-top',
        name: 'Top',
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-2' },
          { kind: 'annotation', id: 'annotation-1' },
        ],
      },
    ]
    const { controller, sceneStore } = createController(file)
    sceneStore.setSelection(['group-low', 'group-top'])

    controller.groupSelected()

    expect(sceneStore.persisted.groups).toEqual([{
      kind: 'group',
      id: 'group-top',
      name: 'Top',
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
        { kind: 'plant', id: 'plant-2' },
        { kind: 'annotation', id: 'annotation-1' },
      ],
    }])
    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['group-top']))
  })

  it('selectSameSpecies selects eligible same-Species plants without dirtying the document', () => {
    const file = makeFile()
    file.plants = [
      ...file.plants,
      {
        id: 'plant-3',
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        color: null,
        position: { x: 30, y: 30 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
      {
        id: 'plant-4',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: { x: 40, y: 40 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: true,
      },
      {
        id: 'plant-5',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: { x: 50, y: 50 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
    ]
    file.groups = [{
      id: 'group-1',
      name: null,
      locked: false,
      members: [{ kind: 'plant', id: 'plant-5' }],
    }]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection(['plant-1'])

    controller.selectSameSpecies()

    expect(sceneStore.session.selectedEntityIds).toEqual(new Set(['plant-1', 'plant-2']))
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(1)
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

  it('updates selected plant symbols through the presentation seam', () => {
    const { controller, sceneStore, state } = createController()
    sceneStore.setSelection(['plant-1', 'plant-2'])

    const changed = controller.setSelectedPlantSymbol('triangle')

    expect(changed).toBe(2)
    expect(sceneStore.persisted.plants.map((plant) => plant.symbol)).toEqual(['triangle', 'triangle'])
    expect(controller.getSelectedPlantSymbolContext()).toMatchObject({
      plantIds: ['plant-1', 'plant-2'],
      sharedCurrentSymbol: 'triangle',
      sharedEffectiveSymbol: 'triangle',
      canClearSelectedSymbol: true,
    })
    expect(state.dirtyTypes).toEqual(['set-selected-plant-symbol'])
    expect(state.invalidations).toBe(1)
  })

  it('clears selected plant symbols back to inherited symbols', () => {
    const file = makeFile()
    file.plant_species_symbols = { 'Malus domestica': 'tree' }
    file.plants = file.plants.map((plant) => ({ ...plant, symbol: 'triangle' }))
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection(['plant-1', 'plant-2'])

    const changed = controller.setSelectedPlantSymbol(null)

    expect(changed).toBe(2)
    expect(sceneStore.persisted.plants.map((plant) => plant.symbol ?? null)).toEqual([null, null])
    expect(controller.getSelectedPlantSymbolContext()).toMatchObject({
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'tree',
      inheritedSymbol: 'tree',
      canClearSelectedSymbol: false,
    })
    expect(state.dirtyTypes).toEqual(['set-selected-plant-symbol'])
  })

  it('updates species symbols through the presentation seam and treats round as an explicit default', () => {
    const { controller, sceneStore, state } = createController()
    sceneStore.setSelection(['plant-1', 'plant-2'])

    const changed = controller.setPlantSymbolForSpecies('Malus domestica', 'round')

    expect(changed).toBe(2)
    expect(sceneStore.persisted.plantSpeciesSymbols).toEqual({
      'Malus domestica': 'round',
    })
    expect(sceneStore.persisted.plants.map((plant) => plant.symbol)).toEqual(['round', 'round'])
    expect(controller.getSelectedPlantSymbolContext()).toMatchObject({
      singleSpeciesDefaultSymbol: 'round',
      inheritedSymbol: 'round',
    })
    expect(state.dirtyTypes).toEqual(['set-plant-symbol-for-species'])
    expect(state.invalidations).toBe(1)
  })

  it('clears species symbol defaults without rewriting existing plants', () => {
    const file = makeFile()
    file.plant_species_symbols = { 'Malus domestica': 'tree' }
    file.plants = file.plants.map((plant) => ({ ...plant, symbol: 'triangle' }))
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.clearPlantSpeciesSymbol('Malus domestica')

    expect(changed).toBe(true)
    expect(sceneStore.persisted.plantSpeciesSymbols).toEqual({})
    expect(sceneStore.persisted.plants.map((plant) => plant.symbol)).toEqual(['triangle', 'triangle'])
    expect(state.dirtyTypes).toEqual(['clear-plant-species-symbol'])
    expect(state.invalidations).toBe(1)
  })

  it('does not resymbol locked Plants through species-wide symbol edits', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-2' ? { ...plant, locked: true } : plant,
    )
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantSymbolForSpecies('Malus domestica', 'tree')
    const lockedPlant = sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')!

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.symbol).toBe('tree')
    expect(lockedPlant.symbol).toBe('round')
    expect(resolvePlantSymbolForPlant(lockedPlant, sceneStore.persisted.plantSpeciesSymbols)).toBe('round')
    expect(sceneStore.persisted.plantSpeciesSymbols).toEqual({
      'Malus domestica': 'tree',
    })
    expect(state.dirtyTypes).toEqual(['set-plant-symbol-for-species'])
  })

  it('does not resymbol locked Plants when clearing a species symbol default', () => {
    const file = makeFile()
    file.plant_species_symbols = { 'Malus domestica': 'tree' }
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-2' ? { ...plant, locked: true } : plant,
    )
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.clearPlantSpeciesSymbol('Malus domestica')
    const lockedPlant = sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')!

    expect(changed).toBe(true)
    expect(sceneStore.persisted.plantSpeciesSymbols).toEqual({})
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.symbol ?? null).toBeNull()
    expect(lockedPlant.symbol).toBe('tree')
    expect(resolvePlantSymbolForPlant(lockedPlant, sceneStore.persisted.plantSpeciesSymbols)).toBe('tree')
    expect(state.dirtyTypes).toEqual(['clear-plant-species-symbol'])
  })

  it('does not resymbol Plants inside locked Object Groups through species-wide symbol edits', () => {
    const file = makeFile()
    file.groups = [{
      id: 'group-1',
      name: null,
      locked: true,
      members: [{ kind: 'plant', id: 'plant-2' }],
    }]
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantSymbolForSpecies('Malus domestica', 'tree')
    const groupedPlant = sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')!

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.symbol).toBe('tree')
    expect(groupedPlant.symbol).toBe('round')
    expect(resolvePlantSymbolForPlant(groupedPlant, sceneStore.persisted.plantSpeciesSymbols)).toBe('round')
    expect(state.dirtyTypes).toEqual(['set-plant-symbol-for-species'])
  })

  it('does not create a species symbol edit while the Plants Layer is locked', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'plants' ? { ...layer, locked: true } : layer,
    )
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantSymbolForSpecies('Malus domestica', 'tree')

    expect(changed).toBe(0)
    expect(sceneStore.persisted.plants.map((plant) => plant.symbol ?? null)).toEqual([null, null])
    expect(sceneStore.persisted.plantSpeciesSymbols).toEqual({})
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('does not recolor locked Plants through species-wide color edits', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-2' ? { ...plant, locked: true } : plant,
    )
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.color).toBe('#C44230')
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')?.color).toBeNull()
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
  })

  it('does not recolor Plants inside locked Object Groups through species-wide color edits', () => {
    const file = makeFile()
    file.groups = [{
      id: 'group-1',
      name: null,
      locked: true,
      members: [{ kind: 'plant', id: 'plant-2' }],
    }]
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.color).toBe('#C44230')
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')?.color).toBeNull()
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
  })

  it('does not recolor Plants inside Object Groups locked by another member', () => {
    const file = makeFile()
    file.plants = [
      ...file.plants,
      {
        id: 'plant-3',
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        color: null,
        position: { x: 30, y: 30 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: true,
      },
    ]
    file.groups = [{
      id: 'group-1',
      name: null,
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-2' },
        { kind: 'plant', id: 'plant-3' },
      ],
    }]
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.color).toBe('#C44230')
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')?.color).toBeNull()
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-3')?.color).toBeNull()
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
  })

  it('does not create a species color edit while the Plants Layer is locked', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'plants' ? { ...layer, locked: true } : layer,
    )
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(0)
    expect(sceneStore.persisted.plants.map((plant) => plant.color)).toEqual([null, null])
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({})
    expect(state.plantSpeciesColorSyncs).toBe(0)
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('sets a species default color when no placed Plants of that species exist', () => {
    const file = makeFile()
    file.plants = []
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(0)
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
  })
})
