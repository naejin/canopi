import { beforeEach, describe, expect, it } from 'vitest'
import { lockedObjectIds } from '../canvas/runtime-mirror-state'
import { selectedObjectIds } from '../canvas/session-state'
import { clearCanvasSelection } from '../canvas/session-state'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import type { CanopiFile } from '../types/design'
import { consortiumTarget, speciesBudgetTarget, speciesTarget } from '../panel-targets'

const BASE_FILE: CanopiFile = {
  version: 2,
  name: 'Demo',
  description: null,
  location: null,
  north_bearing_deg: 0,
  plant_species_colors: {},
  layers: [
    { name: 'base', visible: true, locked: false, opacity: 1 },
    { name: 'contours', visible: false, locked: false, opacity: 1 },
    { name: 'climate', visible: false, locked: false, opacity: 1 },
    { name: 'zones', visible: true, locked: false, opacity: 1 },
    { name: 'water', visible: false, locked: false, opacity: 1 },
    { name: 'plants', visible: true, locked: false, opacity: 1 },
    { name: 'annotations', visible: true, locked: false, opacity: 1 },
  ],
  plants: [],
  zones: [],
  annotations: [],
  consortiums: [],
  groups: [],
  timeline: [],
  budget: [],
  created_at: '2026-04-02T00:00:00.000Z',
  updated_at: '2026-04-02T00:00:00.000Z',
  extra: {},
}

function createPlant(id: string, x: number, y: number, canonical = 'Quercus robur'): CanopiFile['plants'][number] {
  return {
    id,
    canonical_name: canonical,
    common_name: 'Oak',
    color: null,
    position: { x, y },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: 1,
  }
}

describe('SceneCanvasRuntime', () => {
  beforeEach(() => {
    clearCanvasSelection()
    lockedObjectIds.value = new Set()
  })

  it('duplicates plants and supports undo/redo from scene-owned history', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument({
      ...BASE_FILE,
      plants: [createPlant('plant-1', 10, 20)],
      extra: {
        guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
      },
    })

    runtime.selectAll()
    runtime.duplicateSelected()

    const duplicated = runtime.getPlacedPlants()
    expect(duplicated).toHaveLength(2)
    expect(duplicated[1]?.position).toEqual({ x: 30, y: 40 })

    runtime.undo()
    expect(runtime.getPlacedPlants()).toHaveLength(1)

    runtime.redo()
    expect(runtime.getPlacedPlants()).toHaveLength(2)
  })

  it('groups and ungroups selected scene entities without Konva nodes', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument({
      ...BASE_FILE,
      plants: [
        createPlant('plant-1', 10, 20),
        createPlant('plant-2', 30, 40),
      ],
    })

    runtime.selectAll()
    runtime.groupSelected()

    const afterGroup = runtime.getSceneStore().persisted
    expect(afterGroup.groups).toHaveLength(1)
    expect(afterGroup.groups[0]?.memberIds).toEqual(['plant-1', 'plant-2'])

    runtime.ungroupSelected()
    expect(runtime.getSceneStore().persisted.groups).toHaveLength(0)
  })

  it('serializes canvas state while preserving non-canvas document sections', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument({
      ...BASE_FILE,
      plants: [createPlant('plant-1', 10, 20)],
      extra: {
        guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
      },
    })
    runtime.selectAll()
    runtime.setSelectedPlantColor('#228833')

    const serialized = runtime.serializeDocument(
      {
        name: 'Updated',
        location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
        northBearingDeg: 14,
      },
      {
        ...BASE_FILE,
        name: 'Doc copy',
        timeline: [{
          id: 'task-1',
          action_type: 'mulch',
          description: 'Apply mulch',
          start_date: '2026-04-10',
          end_date: null,
          recurrence: null,
          targets: [speciesTarget('Quercus robur')],
          depends_on: null,
          completed: false,
          order: 1,
        }],
        budget_currency: 'EUR',
        budget: [{
          target: speciesBudgetTarget('Quercus robur'),
          category: 'plants',
          description: 'Quercus robur',
          quantity: 1,
          unit_cost: 12,
          currency: 'EUR',
        }],
        consortiums: [{
          target: consortiumTarget('Quercus robur'),
          stratum: 'high',
          start_phase: 0,
          end_phase: 3,
        }],
        extra: {
          guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
          preserved_from_document: true,
        },
      },
    )

    expect(serialized.name).toBe('Updated')
    expect(serialized.location).toEqual({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })
    expect(serialized.north_bearing_deg).toBe(14)
    expect(serialized.timeline).toHaveLength(1)
    expect(serialized.budget).toHaveLength(1)
    expect(serialized.consortiums).toHaveLength(1)
    expect(serialized.budget_currency).toBe('EUR')
    expect(serialized.extra).toEqual({
      guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
      preserved_from_document: true,
    })
    expect(serialized.plants[0]?.color).toBe('#228833')
  })

  it('undo and redo keep document-owned metadata outside scene history', () => {
    const runtime = new SceneCanvasRuntime()
    const documentCopy: CanopiFile = {
      ...BASE_FILE,
      description: 'Document authority description',
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 27,
      plants: [createPlant('plant-1', 10, 20)],
      extra: {
        guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
        preserved_from_document: { nested: true },
      },
    }

    runtime.loadDocument(documentCopy)
    runtime.selectAll()
    runtime.setSelectedPlantColor('#228833')
    runtime.undo()

    const afterUndo = runtime.serializeDocument(
      {
        name: 'Updated',
        description: documentCopy.description,
        location: documentCopy.location,
        northBearingDeg: documentCopy.north_bearing_deg,
      },
      documentCopy,
    )

    expect(afterUndo.description).toBe(documentCopy.description)
    expect(afterUndo.location).toEqual(documentCopy.location)
    expect(afterUndo.north_bearing_deg).toBe(documentCopy.north_bearing_deg)
    expect(afterUndo.extra).toEqual(documentCopy.extra)
    expect(afterUndo.plants[0]?.color).toBeNull()

    runtime.redo()

    const afterRedo = runtime.serializeDocument(
      {
        name: 'Updated',
        description: documentCopy.description,
        location: documentCopy.location,
        northBearingDeg: documentCopy.north_bearing_deg,
      },
      documentCopy,
    )

    expect(afterRedo.description).toBe(documentCopy.description)
    expect(afterRedo.location).toEqual(documentCopy.location)
    expect(afterRedo.north_bearing_deg).toBe(documentCopy.north_bearing_deg)
    expect(afterRedo.extra).toEqual(documentCopy.extra)
    expect(afterRedo.plants[0]?.color).toBe('#228833')
  })

  it('preserves scene-owned species colors when serializing', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument({
      ...BASE_FILE,
      plant_species_colors: {
        'Quercus robur': '#112233',
      },
      plants: [createPlant('plant-1', 10, 20)],
    })

    runtime.setPlantColorForSpecies('Quercus robur', '#228833')

    const serialized = runtime.serializeDocument(
      {
        name: 'Updated',
        location: null,
        northBearingDeg: 0,
      },
      {
        ...BASE_FILE,
        plant_species_colors: {
          'Quercus robur': '#112233',
        },
      },
    )

    expect(serialized.plant_species_colors).toEqual({
      'Quercus robur': '#228833',
    })
  })

  it('defaults document budget currency while serializing', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(BASE_FILE)

    const serialized = runtime.serializeDocument(
      { name: 'Updated' },
      BASE_FILE,
    )

    expect(serialized.budget_currency).toBe('EUR')
  })

  it('keeps scene selection authoritative and mirrors it into canvas signals', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.getSceneStore().setSelection(['plant-1'])
    selectedObjectIds.value = new Set(['mirror-only'])

    expect(runtime.getSelection()).toEqual(new Set(['plant-1']))

    runtime.setSelection(['plant-2'])
    expect(runtime.getSceneStore().session.selectedEntityIds).toEqual(new Set(['plant-2']))
    expect(selectedObjectIds.value).toEqual(new Set(['plant-2']))

    runtime.clearSelection()
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
  })
})
