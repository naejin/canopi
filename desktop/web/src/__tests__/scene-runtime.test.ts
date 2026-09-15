import { beforeEach, describe, expect, it } from 'vitest'
import { clearCanvasSelection, selectedObjectIds } from '../canvas/session-state'
import { createDesktopCanvasRuntimeAppAdapter } from '../app/canvas-runtime/desktop-adapter'
import { beginDesignPlacementEdit } from '../app/design-edit'
import { confirmedSpatialFrame } from '../spatial-frame'
import type { CanopiFile } from '../types/design'
import { consortiumTarget, speciesBudgetTarget, speciesTarget } from '../target'
import {
  createLiveTestCanvasRuntimeHost,
  type TestCanvasRuntimeHostOptions,
} from './support/live-canvas-runtime'
import {
  currentDesign,
  designSessionFixture,
} from './support/design-session-state'

const BASE_FILE: CanopiFile = {
  version: 6,
  name: 'Demo',
  description: null,
  spatial_frame: { anchor_longitude_deg: 13, anchor_latitude_deg: 23, north_bearing_deg: 0, placement_status: 'provisional', location_metadata: { altitude_m: null } },
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
  budget_currency: 'EUR',
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
    locked: false,
  }
}

function createEllipseZone(
  name: string,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
): CanopiFile['zones'][number] {
  return {
    name,
    zone_type: 'ellipse',
    points: [
      { x, y },
      { x: radiusX, y: radiusY },
    ],
    rotation: 0,
    fill_color: null,
    notes: null,
    locked: false,
  }
}

function createAnnotation(
  id: string,
  x: number,
  y: number,
  text = 'Scale dependent annotation',
): CanopiFile['annotations'][number] {
  return {
    id,
    annotation_type: 'text',
    position: { x, y },
    text,
    font_size: 20,
    rotation: null,
    locked: false,
  }
}

function createRuntimeHost(options: TestCanvasRuntimeHostOptions = {}) {
  return createLiveTestCanvasRuntimeHost(options)
}

function createRuntimeHostWithAppComposition() {
  return createRuntimeHost({
    appAdapter: createDesktopCanvasRuntimeAppAdapter(),
  })
}

describe('Canvas runtime surfaces', () => {
  beforeEach(() => {
    clearCanvasSelection()
  })

  it('pastes copied Design Objects one meter to the right and advances repeated pastes', () => {
    const host = createRuntimeHost()
    const { commands, documents, queries } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        plants: [createPlant('plant-1', 10, 20)],
      })

      commands.sceneEdits.selectAll()
      commands.sceneEdits.copy()
      commands.sceneEdits.paste()
      commands.sceneEdits.paste()

      const pasted = queries.getPlacedPlants()
      expect(pasted).toHaveLength(3)
      expect(pasted[1]?.position).toEqual({ x: 11, y: 20 })
      expect(pasted[2]?.position).toEqual({ x: 12, y: 20 })

      commands.history.undo()
      expect(queries.getPlacedPlants()).toHaveLength(2)

      commands.history.undo()
      expect(queries.getPlacedPlants()).toHaveLength(1)
    } finally {
      host.destroy()
    }
  })

  it('pastes copied Design Objects at a canvas point using the copied selection center as anchor', () => {
    const host = createRuntimeHost()
    const { commands, documents, queries } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        plants: [
          createPlant('plant-1', 10, 20),
          createPlant('plant-2', 14, 20),
        ],
      })

      commands.sceneEdits.selectAll()
      commands.sceneEdits.copy()
      commands.sceneEdits.pasteAt({ x: 100, y: 50 })

      const pasted = queries.getPlacedPlants()
      expect(pasted).toHaveLength(4)
      expect(pasted[2]?.position).toEqual({ x: 98, y: 50 })
      expect(pasted[3]?.position).toEqual({ x: 102, y: 50 })
    } finally {
      host.destroy()
    }
  })

  it('context-pastes copied annotations at the clicked point after viewport scale changes', () => {
    const host = createRuntimeHost()
    const { commands, documents, queries } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        annotations: [createAnnotation('annotation-1', 10, 20)],
      })

      commands.sceneEdits.selectAll()
      commands.sceneEdits.copy()
      commands.viewport.zoomIn()
      commands.viewport.zoomIn()
      commands.sceneEdits.pasteAt({ x: 100, y: 50 })

      const scene = queries.getSceneSnapshot()
      expect(scene.annotations).toHaveLength(2)
      expect(scene.annotations[1]?.id).not.toBe('annotation-1')

      const selection = queries.getDesignObjectSelection()
      expect(selection.editableTargets).toEqual([{ kind: 'annotation', id: scene.annotations[1]!.id }])
      expect(selection.bounds).not.toBeNull()
      expect((selection.bounds!.minX + selection.bounds!.maxX) / 2).toBeCloseTo(100, 5)
      expect((selection.bounds!.minY + selection.bounds!.maxY) / 2).toBeCloseTo(50, 5)
    } finally {
      host.destroy()
    }
  })

  it('preserves elliptical Zone radii when pasting, duplicating, and context-pasting', () => {
    const host = createRuntimeHost()
    const { commands, documents, queries } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        zones: [createEllipseZone('ellipse-bed', 10, 20, 3, 2)],
      })

      commands.sceneEdits.selectAll()
      commands.sceneEdits.copy()
      commands.sceneEdits.paste()

      let scene = queries.getSceneSnapshot()
      expect(scene.zones[1]?.points).toEqual([
        { x: 11, y: 20 },
        { x: 3, y: 2 },
      ])
      expect(queries.getSelection()).toEqual([{ kind: 'zone', id: scene.zones[1]!.name }])

      commands.sceneEdits.duplicateSelected()

      scene = queries.getSceneSnapshot()
      expect(scene.zones[2]?.points).toEqual([
        { x: 12, y: 20 },
        { x: 3, y: 2 },
      ])

      commands.sceneEdits.copy()
      commands.sceneEdits.pasteAt({ x: 100, y: 50 })

      scene = queries.getSceneSnapshot()
      expect(scene.zones[3]?.points).toEqual([
        { x: 100, y: 50 },
        { x: 3, y: 2 },
      ])
      expect(queries.getSelection()).toEqual([{ kind: 'zone', id: scene.zones[3]!.name }])

      commands.history.undo()
      expect(queries.getSceneSnapshot().zones).toHaveLength(3)

      commands.history.redo()
      scene = queries.getSceneSnapshot()
      expect(scene.zones[3]?.points).toEqual([
        { x: 100, y: 50 },
        { x: 3, y: 2 },
      ])
    } finally {
      host.destroy()
    }
  })

  it('duplicates plants and supports undo/redo from scene-owned history', () => {
    const host = createRuntimeHost()
    const { commands, documents, queries } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        plants: [{ ...createPlant('plant-1', 10, 20), pinned_name: true }],
        extra: {
          guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
        },
      })

      commands.sceneEdits.selectAll()
      commands.sceneEdits.duplicateSelected()

      const duplicated = queries.getPlacedPlants()
      expect(duplicated).toHaveLength(2)
      expect(duplicated[1]?.position).toEqual({ x: 11, y: 20 })
      expect(duplicated[1]?.pinned_name).toBe(true)

      commands.sceneEdits.duplicateSelected()
      const duplicatedAgain = queries.getPlacedPlants()
      expect(duplicatedAgain).toHaveLength(3)
      expect(duplicatedAgain[2]?.position).toEqual({ x: 12, y: 20 })
      expect(duplicatedAgain[2]?.pinned_name).toBe(true)

      commands.history.undo()
      expect(queries.getPlacedPlants()).toHaveLength(2)

      commands.history.redo()
      expect(queries.getPlacedPlants()).toHaveLength(3)
    } finally {
      host.destroy()
    }
  })

  it('orders Design placement and later Scene edits through the global undo commands', () => {
    designSessionFixture.file = {
      ...BASE_FILE,
      plants: [createPlant('plant-1', 10, 20)],
    }
    const placement = beginDesignPlacementEdit()
    placement.preview(confirmedSpatialFrame(placement.original, {
      lat: 48.8566,
      lon: 2.3522,
      altitude_m: 35,
    }))
    placement.commit()

    const host = createRuntimeHostWithAppComposition()
    const { commands, documents, queries } = host.surfaces
    try {
      documents.loadDocument(currentDesign.value!)
      expect(commands.layers.setSceneLayerVisibility('plants', false)).toBe(true)

      commands.history.undo()
      expect(queries.getSceneSnapshot().layers.find((layer) => layer.name === 'plants')?.visible).toBe(true)
      expect(currentDesign.value?.spatial_frame.placement_status).toBe('confirmed')

      commands.history.undo()
      expect(currentDesign.value?.spatial_frame.placement_status).toBe('provisional')
      expect(queries.getPlacedPlants()).toHaveLength(1)

      commands.history.redo()
      expect(currentDesign.value?.spatial_frame.placement_status).toBe('confirmed')
      expect(queries.getSceneSnapshot().layers.find((layer) => layer.name === 'plants')?.visible).toBe(true)

      commands.history.redo()
      expect(queries.getSceneSnapshot().layers.find((layer) => layer.name === 'plants')?.visible).toBe(false)
    } finally {
      host.destroy()
      designSessionFixture.file = null
    }
  })

  it('discards redo from both participants when global history branches', () => {
    designSessionFixture.file = {
      ...BASE_FILE,
      plants: [createPlant('plant-1', 10, 20)],
    }
    const placement = beginDesignPlacementEdit()
    placement.preview(confirmedSpatialFrame(placement.original, {
      lat: 48.8566,
      lon: 2.3522,
      altitude_m: 35,
    }))
    placement.commit()

    const host = createRuntimeHostWithAppComposition()
    const { commands, documents, queries } = host.surfaces
    try {
      documents.loadDocument(currentDesign.value!)

      commands.history.undo()
      expect(currentDesign.value?.spatial_frame.placement_status).toBe('provisional')
      expect(commands.history.canRedo.value).toBe(true)

      commands.layers.setSceneLayerVisibility('plants', false)
      expect(commands.history.canRedo.value).toBe(false)
      commands.history.redo()
      expect(currentDesign.value?.spatial_frame.placement_status).toBe('provisional')

      commands.history.undo()
      expect(queries.getSceneSnapshot().layers.find((layer) => layer.name === 'plants')?.visible)
        .toBe(true)
      expect(commands.history.canRedo.value).toBe(true)

      const replacementPlacement = beginDesignPlacementEdit()
      replacementPlacement.preview(confirmedSpatialFrame(replacementPlacement.original, {
        lat: 51.5072,
        lon: -0.1276,
        altitude_m: 11,
      }))
      replacementPlacement.commit()
      expect(commands.history.canRedo.value).toBe(false)
      commands.history.redo()
      expect(queries.getSceneSnapshot().layers.find((layer) => layer.name === 'plants')?.visible)
        .toBe(true)
    } finally {
      host.destroy()
      designSessionFixture.file = null
    }
  })

  it('toggles pinned plant names for selected plants and persists the state', () => {
    const host = createRuntimeHost()
    const { commands, documents, queries } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        plants: [
          { ...createPlant('plant-1', 10, 20), pinned_name: true },
          createPlant('plant-2', 20, 20),
        ],
        zones: [createEllipseZone('zone-1', 0, 0, 5, 5)],
      })

      commands.sceneEdits.selectAll()
      commands.sceneEdits.toggleSelectedPlantNamePins()

      expect(queries.getPlacedPlants().map((plant) => plant.pinned_name ?? false)).toEqual([true, true])

      commands.sceneEdits.toggleSelectedPlantNamePins()

      expect(queries.getPlacedPlants().map((plant) => plant.pinned_name ?? false)).toEqual([false, false])
      expect(
        documents
          .captureForPersistence({ name: 'Pinned names' }, { ...BASE_FILE, name: 'Pinned names' })
          .content
          .plants
          .map((plant) => plant.pinned_name ?? false),
      ).toEqual([false, false])
      expect(queries.getSceneSnapshot().zones).toHaveLength(1)
    } finally {
      host.destroy()
    }
  })

  it('duplicates Object Groups one meter to the right while preserving member layout', () => {
    const host = createRuntimeHost()
    const { commands, documents, queries } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        plants: [
          createPlant('plant-1', 10, 20),
          createPlant('plant-2', 12, 20),
        ],
      })

      commands.sceneEdits.selectAll()
      commands.sceneEdits.groupSelected()
      const originalGroupId = [...selectedObjectIds.value][0]!

      commands.sceneEdits.duplicateSelected()

      const scene = queries.getSceneSnapshot()
      expect(scene.groups).toHaveLength(2)
      expect(scene.plants).toHaveLength(4)
      const clonedGroup = scene.groups.find((group) => group.id !== originalGroupId)!
      const clonedMembers = clonedGroup.members
        .filter((member) => member.kind === 'plant')
        .map((member) => scene.plants.find((plant) => plant.id === member.id)?.position)
        .filter((position): position is { x: number; y: number } => position !== undefined)
        .sort((left, right) => left.x - right.x)

      expect(clonedMembers).toEqual([
        { x: 11, y: 20 },
        { x: 13, y: 20 },
      ])
      expect(selectedObjectIds.value).toEqual(new Set([clonedGroup.id]))
    } finally {
      host.destroy()
    }
  })

  it.each(['paste', 'pasteAt', 'duplicateSelected'] as const)(
    'selects cloned Groups and ungrouped Design Objects after %s',
    (placementCommand) => {
      const host = createRuntimeHost()
      const { commands, documents, queries } = host.surfaces

      try {
        documents.loadDocument({
          ...BASE_FILE,
          plants: [
            createPlant('plant-1', 10, 20),
            createPlant('plant-2', 12, 20),
            createPlant('plant-3', 20, 20),
          ],
          groups: [{
            id: 'group-1',
            locked: false,
            name: 'Pair',
            members: [
              { kind: 'plant', id: 'plant-1' },
              { kind: 'plant', id: 'plant-2' },
            ],
          }],
        })

        commands.sceneEdits.selectAll()
        expect(queries.getSelection()).toEqual([
          { kind: 'plant', id: 'plant-3' },
          { kind: 'group', id: 'group-1' },
        ])
        if (placementCommand === 'duplicateSelected') {
          commands.sceneEdits.duplicateSelected()
        } else {
          commands.sceneEdits.copy()
          if (placementCommand === 'pasteAt') commands.sceneEdits.pasteAt({ x: 100, y: 50 })
          else commands.sceneEdits.paste()
        }

        const scene = queries.getSceneSnapshot()
        const clonedGroup = scene.groups.find((group) => group.id !== 'group-1')!
        const clonedMemberIds = new Set(clonedGroup.members.map((member) => member.id))
        const clonedUngroupedPlant = scene.plants.find((plant) => (
          !['plant-1', 'plant-2', 'plant-3'].includes(plant.id)
          && !clonedMemberIds.has(plant.id)
        ))!

        expect(queries.getSelection()).toEqual([
          { kind: 'group', id: clonedGroup.id },
          { kind: 'plant', id: clonedUngroupedPlant.id },
        ])
      } finally {
        host.destroy()
      }
    },
  )

  it('groups and ungroups selected scene entities through runtime state', () => {
    const host = createRuntimeHost()
    const { commands, documents, queries } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        plants: [
          createPlant('plant-1', 10, 20),
          createPlant('plant-2', 30, 40),
        ],
      })

      commands.sceneEdits.selectAll()
      commands.sceneEdits.groupSelected()

      const afterGroup = queries.getSceneSnapshot()
      expect(afterGroup.groups).toHaveLength(1)
      expect(afterGroup.groups[0]?.members).toEqual([
        { kind: 'plant', id: 'plant-1' },
        { kind: 'plant', id: 'plant-2' },
      ])

      commands.sceneEdits.ungroupSelected()
      expect(queries.getSceneSnapshot().groups).toHaveLength(0)
    } finally {
      host.destroy()
    }
  })

  it('serializes canvas state while preserving non-canvas document sections', () => {
    const host = createRuntimeHostWithAppComposition()
    const { commands, documents } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        plants: [createPlant('plant-1', 10, 20)],
        extra: {
          guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
        },
      })
      commands.sceneEdits.selectAll()
      commands.plantPresentation.setSelectedPlantColor('#228833')

      const serialized = documents.captureForPersistence(
        {
          name: 'Updated',
          spatialFrame: { anchor_longitude_deg: 2.3522, anchor_latitude_deg: 48.8566, north_bearing_deg: 14, placement_status: 'confirmed', location_metadata: { altitude_m: 35 } },
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
      ).content

      expect(serialized.name).toBe('Updated')
      expect(serialized.spatial_frame).toEqual({ anchor_longitude_deg: 2.3522, anchor_latitude_deg: 48.8566, north_bearing_deg: 14, placement_status: 'confirmed', location_metadata: { altitude_m: 35 } })
      expect(serialized.timeline).toHaveLength(1)
      expect(serialized.budget).toHaveLength(1)
      expect(serialized.consortiums).toHaveLength(1)
      expect(serialized.budget_currency).toBe('EUR')
      expect(serialized.extra).toEqual({
        guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
        preserved_from_document: true,
      })
      expect(serialized.plants[0]?.color).toBe('#228833')
    } finally {
      host.destroy()
    }
  })

  it('undo and redo keep document-owned metadata outside scene history', () => {
    const host = createRuntimeHostWithAppComposition()
    const { commands, documents } = host.surfaces
    const documentCopy: CanopiFile = {
      ...BASE_FILE,
      description: 'Document authority description',
      spatial_frame: { anchor_longitude_deg: 2.3522, anchor_latitude_deg: 48.8566, north_bearing_deg: 27, placement_status: 'confirmed', location_metadata: { altitude_m: 35 } },
      plants: [createPlant('plant-1', 10, 20)],
      extra: {
        guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
        preserved_from_document: { nested: true },
      },
    }

    try {
      documents.loadDocument(documentCopy)
      commands.sceneEdits.selectAll()
      commands.plantPresentation.setSelectedPlantColor('#228833')
      commands.history.undo()

      const afterUndo = documents.captureForPersistence(
        {
          name: 'Updated',
          description: documentCopy.description,
          spatialFrame: documentCopy.spatial_frame,
        },
        documentCopy,
      ).content

      expect(afterUndo.description).toBe(documentCopy.description)
      expect(afterUndo.spatial_frame).toEqual(documentCopy.spatial_frame)
      expect(afterUndo.extra).toEqual(documentCopy.extra)
      expect(afterUndo.plants[0]?.color).toBeNull()

      commands.history.redo()

      const afterRedo = documents.captureForPersistence(
        {
          name: 'Updated',
          description: documentCopy.description,
          spatialFrame: documentCopy.spatial_frame,
        },
        documentCopy,
      ).content

      expect(afterRedo.description).toBe(documentCopy.description)
      expect(afterRedo.spatial_frame).toEqual(documentCopy.spatial_frame)
      expect(afterRedo.extra).toEqual(documentCopy.extra)
      expect(afterRedo.plants[0]?.color).toBe('#228833')
    } finally {
      host.destroy()
    }
  })

  it('preserves scene-owned species colors when serializing', () => {
    const host = createRuntimeHost()
    const { commands, documents } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        plant_species_colors: {
          'Quercus robur': '#112233',
        },
        plants: [createPlant('plant-1', 10, 20)],
      })

      commands.plantPresentation.setPlantColorForSpecies('Quercus robur', '#228833')

      const serialized = documents.captureForPersistence(
        {
          name: 'Updated',
        },
        {
          ...BASE_FILE,
          plant_species_colors: {
            'Quercus robur': '#112233',
          },
        },
      ).content

      expect(serialized.plant_species_colors).toEqual({
        'Quercus robur': '#228833',
      })
    } finally {
      host.destroy()
    }
  })

  it('defaults document budget currency while serializing', () => {
    const host = createRuntimeHost()
    const { documents } = host.surfaces

    try {
      documents.loadDocument(BASE_FILE)

      const serialized = documents.captureForPersistence(
        { name: 'Updated' },
        BASE_FILE,
      ).content

      expect(serialized.budget_currency).toBe('EUR')
    } finally {
      host.destroy()
    }
  })

  it('keeps scene selection authoritative and mirrors it into canvas signals', () => {
    const host = createRuntimeHost()
    const { commands, documents, queries } = host.surfaces

    try {
      documents.loadDocument({
        ...BASE_FILE,
        plants: [
          createPlant('plant-1', 10, 20),
          createPlant('plant-2', 30, 40),
        ],
      })
      selectedObjectIds.value = new Set(['mirror-only'])

      commands.sceneEdits.selectAll()
      expect(queries.getSelection()).toEqual([
        { kind: 'plant', id: 'plant-1' },
        { kind: 'plant', id: 'plant-2' },
      ])
      expect(selectedObjectIds.value).toEqual(new Set(['plant-1', 'plant-2']))

      commands.sceneEdits.deleteSelected()
      expect(queries.getSelection()).toEqual([])
      expect(selectedObjectIds.value.size).toBe(0)
    } finally {
      host.destroy()
    }
  })
})
