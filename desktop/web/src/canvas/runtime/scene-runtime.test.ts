import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ipc/species', () => ({
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))
import {
  guides,
  layerOpacity,
  layerVisibility,
  lockedObjectIds,
  snapToGridEnabled,
} from '../../state/canvas'
import { plantColorMenuOpen } from '../plant-color-menu-state'
import { plantColorByAttr, plantSizeMode } from '../plant-display-state'
import { plantStampSpecies } from '../plant-tool-state'
import { activeTool, selectedObjectIds } from '../session-state'
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from '../../app/panel-targets/state'
import { canvasClean } from '../../state/design'
import { locale } from '../../app/settings/state'
import type { CanopiFile } from '../../types/design'
import { speciesTarget } from '../../panel-targets'
import { SceneCanvasRuntime } from './scene-runtime.ts'
import { getCommonNames } from '../../ipc/species'

function makeFile(): CanopiFile {
  return {
    version: 1,
    name: 'Runtime demo',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    layers: [
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
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
      },
    ],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    created_at: '2026-04-02T00:00:00.000Z',
    updated_at: '2026-04-02T00:00:00.000Z',
    extra: {},
  }
}

function createRendererStub() {
  return {
    id: 'test',
    resize: vi.fn(),
    renderScene: vi.fn(),
    setViewport: vi.fn(),
    dispose: vi.fn(),
  }
}

async function initRuntimeWithStubbedRenderer(runtime: SceneCanvasRuntime) {
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })

  const renderer = createRendererStub()
  ;(runtime as any)._rendererHost = {
    initialize: async () => renderer,
    run: async (operation: (instance: typeof renderer) => unknown) => operation(renderer),
    dispose: async () => {},
  }

  await runtime.init(container)
  return { container, renderer }
}

describe('scene canvas runtime', () => {
  beforeEach(() => {
    activeTool.value = 'select'
    locale.value = 'en'
    selectedObjectIds.value = new Set()
    lockedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
    plantStampSpecies.value = null
    snapToGridEnabled.value = false
    guides.value = []
    hoveredCanvasTargets.value = []
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
    layerVisibility.value = {}
    layerOpacity.value = {}
    plantSizeMode.value = 'default'
    plantColorByAttr.value = null
    canvasClean.value = true
    vi.mocked(getCommonNames).mockReset()
    vi.mocked(getCommonNames).mockResolvedValue({})
  })

  it('groups, duplicates, and deletes grouped scene entities', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())

    runtime.getSceneStore().setSelection(['plant-1', 'plant-2'])
    selectedObjectIds.value = new Set(['plant-1', 'plant-2'])
    runtime.groupSelected()

    const grouped = runtime.getSceneStore().persisted
    expect(grouped.groups).toHaveLength(1)
    const groupId = grouped.groups[0]!.id
    expect(selectedObjectIds.value).toEqual(new Set([groupId]))

    runtime.duplicateSelected()

    const duplicated = runtime.getSceneStore().persisted
    expect(duplicated.groups).toHaveLength(2)
    expect(duplicated.plants).toHaveLength(4)
    const duplicateGroupId = [...selectedObjectIds.value][0]!
    expect(duplicateGroupId).not.toBe(groupId)

    runtime.deleteSelected()

    const afterDelete = runtime.getSceneStore().persisted
    expect(afterDelete.groups).toHaveLength(1)
    expect(afterDelete.plants).toHaveLength(2)
    expect(selectedObjectIds.value.size).toBe(0)
  })

  it('selectAll prefers top-level group ids and skips locked items', () => {
    const runtime = new SceneCanvasRuntime()
    const file = makeFile()
    file.groups = [
      {
        id: 'group-1',
        name: null,
        layer: 'plants',
        position: { x: 10, y: 10 },
        rotation: null,
        member_ids: ['plant-1', 'plant-2'],
      },
    ]
    runtime.loadDocument(file)
    lockedObjectIds.value = new Set(['zone-1'])

    runtime.selectAll()

    expect(selectedObjectIds.value).toEqual(new Set(['group-1']))
  })

  it('applies selected plant colors through grouped selection', () => {
    const runtime = new SceneCanvasRuntime()
    const file = makeFile()
    file.groups = [
      {
        id: 'group-1',
        name: null,
        layer: 'plants',
        position: { x: 10, y: 10 },
        rotation: null,
        member_ids: ['plant-1', 'plant-2'],
      },
    ]
    runtime.loadDocument(file)
    runtime.getSceneStore().setSelection(['group-1'])
    selectedObjectIds.value = new Set(['group-1'])

    const changed = runtime.setSelectedPlantColor('#ff5500')

    expect(changed).toBe(2)
    expect(runtime.getSelectedPlantColorContext()).toMatchObject({
      plantIds: ['plant-1', 'plant-2'],
      sharedCurrentColor: '#FF5500',
      singleSpeciesCanonicalName: 'Malus domestica',
    })
  })

  it('toggles snap-to-grid through shared canvas state', () => {
    const runtime = new SceneCanvasRuntime()

    runtime.toggleSnapToGrid()
    expect(snapToGridEnabled.value).toBe(true)

    runtime.toggleSnapToGrid()
    expect(snapToGridEnabled.value).toBe(false)
  })

  it('owns plant presentation state in scene session and mirrors it to canvas signals', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())

    runtime.setPlantSizeMode('canopy')
    runtime.setPlantColorByAttr('flower')

    expect(runtime.getPlantSizeMode()).toBe('canopy')
    expect(runtime.getPlantColorByAttr()).toBe('flower')
    expect(runtime.getSceneStore().session.plantSizeMode).toBe('canopy')
    expect(runtime.getSceneStore().session.plantColorByAttr).toBe('flower')
    expect(plantSizeMode.value).toBe('canopy')
    expect(plantColorByAttr.value).toBe('flower')
  })

  it('bumps viewportRevision on viewport-only camera changes', async () => {
    const runtime = new SceneCanvasRuntime()
    await initRuntimeWithStubbedRenderer(runtime)

    const before = runtime.viewportRevision.value
    runtime.zoomIn()

    expect(runtime.viewportRevision.value).toBeGreaterThan(before)
  })

  it('derives selected plant context from scene session, not the mirror signal', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())

    runtime.getSceneStore().setSelection(['plant-1'])
    selectedObjectIds.value = new Set(['plant-2'])

    expect(runtime.getSelectedPlantColorContext().plantIds).toEqual(['plant-1'])
  })

  it('keeps runtime-backed selection authoritative over the mirror signal', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())

    runtime.getSceneStore().setSelection(['plant-1'])
    selectedObjectIds.value = new Set(['zone-1'])

    expect(runtime.getSelection()).toEqual(new Set(['plant-1']))

    runtime.setSelection(['plant-2'])
    expect(runtime.getSceneStore().session.selectedEntityIds).toEqual(new Set(['plant-2']))
    expect(selectedObjectIds.value).toEqual(new Set(['plant-2']))

    runtime.clearSelection()
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
  })

  it('resolves hovered panel targets for renderer highlights without mutating selection', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    renderer.renderScene.mockClear()
    hoveredPanelTargets.value = [
      speciesTarget('Malus domestica'),
      { kind: 'zone', zone_name: 'zone-1' },
      { kind: 'placed_plant', plant_id: 'missing-plant' },
    ]

    await vi.waitFor(() => {
      expect(renderer.renderScene).toHaveBeenCalled()
    })

    const snapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
    expect(snapshot?.highlightedPlantIds).toEqual(new Set(['plant-1', 'plant-2']))
    expect(snapshot?.highlightedZoneIds).toEqual(new Set(['zone-1']))
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    runtime.destroy()
  })

  it('resolves selected panel targets for renderer highlights without mutating canvas selection or dirty state', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    renderer.renderScene.mockClear()
    selectedPanelTargets.value = [
      speciesTarget('Malus domestica'),
      { kind: 'zone', zone_name: 'zone-1' },
    ]

    await vi.waitFor(() => {
      expect(renderer.renderScene).toHaveBeenCalled()
    })

    const snapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
    expect(snapshot?.highlightedPlantIds).toEqual(new Set(['plant-1', 'plant-2']))
    expect(snapshot?.highlightedZoneIds).toEqual(new Set(['zone-1']))
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(canvasClean.value).toBe(true)
    runtime.destroy()
  })

  it('keeps typed panel target highlights separate when plant IDs and zone names collide', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument({
      ...makeFile(),
      plants: [
        {
          ...makeFile().plants[0]!,
          id: 'colliding-id',
          canonical_name: 'Malus domestica',
        },
      ],
      zones: [
        {
          ...makeFile().zones[0]!,
          name: 'colliding-id',
        },
      ],
    })
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    renderer.renderScene.mockClear()
    hoveredPanelTargets.value = [{ kind: 'zone', zone_name: 'colliding-id' }]

    await vi.waitFor(() => {
      expect(renderer.renderScene).toHaveBeenCalled()
    })

    const snapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
    expect(snapshot?.highlightedPlantIds).toEqual(new Set())
    expect(snapshot?.highlightedZoneIds).toEqual(new Set(['colliding-id']))
    runtime.destroy()
  })

  it('unions selected and hovered panel target highlights without mutating canvas selection', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    renderer.renderScene.mockClear()
    selectedPanelTargets.value = [speciesTarget('Malus domestica')]
    hoveredPanelTargets.value = [{ kind: 'zone', zone_name: 'zone-1' }]

    await vi.waitFor(() => {
      const snapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
      expect(snapshot?.highlightedPlantIds).toEqual(new Set(['plant-1', 'plant-2']))
      expect(snapshot?.highlightedZoneIds).toEqual(new Set(['zone-1']))
    })

    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    runtime.destroy()
  })

  it('publishes canvas-origin species hover targets without mutating selection', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())
    await initRuntimeWithStubbedRenderer(runtime)

    ;(runtime as any)._interaction._deps.setHoveredEntityId('plant-1')

    expect(hoveredCanvasTargets.value).toEqual([speciesTarget('Malus domestica')])
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(canvasClean.value).toBe(true)

    ;(runtime as any)._interaction._deps.setHoveredEntityId(null)

    expect(hoveredCanvasTargets.value).toEqual([])
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(canvasClean.value).toBe(true)
    runtime.destroy()
  })

  it('clears canvas-origin hover during destroy without rendering into a disposing renderer', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    ;(runtime as any)._interaction._deps.setHoveredEntityId('plant-1')
    expect(hoveredCanvasTargets.value).toEqual([speciesTarget('Malus domestica')])

    renderer.renderScene.mockClear()
    runtime.destroy()

    expect(hoveredCanvasTargets.value).toEqual([])
    expect(renderer.renderScene).not.toHaveBeenCalled()
  })

  it('uses the viewport-only renderer path for zoom updates', async () => {
    const runtime = new SceneCanvasRuntime()
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)
    const viewport = (runtime as any)._camera.initialize({ width: 400, height: 300 })
    runtime.getSceneStore().setViewport(viewport)

    renderer.renderScene.mockClear()
    runtime.zoomIn()
    await Promise.resolve()
    await Promise.resolve()

    expect(renderer.setViewport).toHaveBeenCalled()
    expect(renderer.renderScene).not.toHaveBeenCalled()
    runtime.destroy()
  })

  it('bumps viewport revision for zoom and resize updates', async () => {
    const runtime = new SceneCanvasRuntime()
    await initRuntimeWithStubbedRenderer(runtime)
    const initialRevision = runtime.viewportRevision.value

    runtime.zoomIn()
    expect(runtime.viewportRevision.value).toBe(initialRevision + 1)

    runtime.resize(400, 300)
    expect(runtime.viewportRevision.value).toBe(initialRevision + 2)
    runtime.destroy()
  })

  it('resets transient runtime state before replacing the document', async () => {
    const runtime = new SceneCanvasRuntime()
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    runtime.loadDocument(makeFile())
    runtime.setTool('plant-stamp')
    activeTool.value = 'plant-stamp'
    plantStampSpecies.value = {
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    }
    plantColorMenuOpen.value = true
    lockedObjectIds.value = new Set(['zone-1'])
    selectedObjectIds.value = new Set(['plant-1'])
    hoveredPanelTargets.value = [speciesTarget('Malus domestica')]
    selectedPanelTargetOrigin.value = 'timeline'
    selectedPanelTargets.value = [{ kind: 'zone', zone_name: 'zone-1' }]
    runtime.getSceneStore().setSelection(['plant-1'])

    renderer.renderScene.mockClear()
    runtime.replaceDocument(makeFile())
    await Promise.resolve()
    await Promise.resolve()

    expect(activeTool.value).toBe('select')
    expect(plantStampSpecies.value).toBe(null)
    expect(plantColorMenuOpen.value).toBe(false)
    expect(lockedObjectIds.value.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(hoveredPanelTargets.value).toEqual([])
    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
    runtime.destroy()
  })

  it('invalidates the scene after select-all and lock mutations', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())
    const invalidate = vi.spyOn(runtime as any, '_invalidate')

    invalidate.mockClear()
    runtime.selectAll()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenLastCalledWith('scene')

    invalidate.mockClear()
    runtime.lockSelected()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenLastCalledWith('scene')

    invalidate.mockClear()
    runtime.unlockSelected()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenLastCalledWith('scene')
  })

  it('serializes signal-backed layer state and guides through the scene runtime', () => {
    const runtime = new SceneCanvasRuntime()
    const file = makeFile()
    runtime.loadDocument(file)

    layerVisibility.value = {
      ...layerVisibility.value,
      plants: false,
    }
    layerOpacity.value = {
      ...layerOpacity.value,
      zones: 0.4,
    }
    guides.value = [{ id: 'guide-1', axis: 'v', position: 42 }]

    const serialized = runtime.serializeDocument({ name: file.name }, file)

    expect(serialized.layers.find((layer) => layer.name === 'plants')?.visible).toBe(false)
    expect(serialized.layers.find((layer) => layer.name === 'zones')?.opacity).toBe(0.4)
    expect(serialized.extra).toEqual({
      guides: [{ id: 'guide-1', axis: 'v', position: 42 }],
    })
  })

  it('marks the canvas dirty when only the species default color changes', () => {
    const runtime = new SceneCanvasRuntime()
    const file = makeFile()
    file.plant_species_colors = {
      'Malus domestica': '#112233',
    }
    file.plants[0]!.color = '#C44230'
    file.plants[1]!.color = '#C44230'
    runtime.loadDocument(file)
    runtime.markSaved()

    const changed = runtime.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(0)
    expect(canvasClean.value).toBe(false)
    expect(runtime.serializeDocument({ name: file.name }, file).plant_species_colors).toEqual({
      'Malus domestica': '#C44230',
    })
  })

  it('refreshes localized common names in renderer snapshots when the active locale changes', async () => {
    vi.mocked(getCommonNames)
      .mockResolvedValueOnce({ 'Malus domestica': 'Apple' })
      .mockResolvedValueOnce({ 'Malus domestica': 'Pommier' })

    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)
    await Promise.resolve()
    await Promise.resolve()

    const initialSnapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
    expect(initialSnapshot?.localizedCommonNames.get('Malus domestica')).toBe('Apple')
    const initialRenderCount = renderer.renderScene.mock.calls.length

    locale.value = 'fr'
    await vi.waitFor(() => {
      expect(renderer.renderScene.mock.calls.length).toBeGreaterThan(initialRenderCount)
    })

    const localizedSnapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
    expect(localizedSnapshot?.localizedCommonNames.get('Malus domestica')).toBe('Pommier')
    runtime.destroy()
  })
})
