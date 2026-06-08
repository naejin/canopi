import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ipc/species', () => ({
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))
import {
  snapToGridEnabled,
} from '../../app/canvas-settings/signals'
import { layerLockState, layerOpacity, layerVisibility } from '../../app/canvas-settings/signals'
import { guides } from '../scene-metadata-state'
import { plantColorMenuOpen } from '../plant-color-menu-state'
import { plantColorByAttr, plantSizeMode } from '../plant-display-state'
import {
  clearPlantStampSource,
  readPlantStampSource,
  selectPlantStampSource,
} from '../plant-stamp-source'
import { activeTool, selectedObjectIds } from '../session-state'
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from '../../app/panel-targets/state'
import { createAppCanvasRuntimeAppAdapter } from '../../app/canvas-runtime/app-adapter'
import { createAppSceneRuntimePanelTargetAdapter } from '../../app/canvas-runtime/panel-target-adapter'
import { locale, plantSpacingIntervalM } from '../../app/settings/state'
import type { CanopiFile, PanelTarget } from '../../types/design'
import { speciesTarget } from '../../target'
import { SceneCanvasRuntime } from './scene-runtime.ts'
import type { SceneRuntimePanelTargetAdapter } from './scene-runtime/panel-target-adapter'
import type {
  CanvasRuntimeAppAdapter,
  CanvasRuntimeDocumentCompositionInput,
  CanvasRuntimeSettingsAdapter,
} from './app-adapter'
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

function zoneMeasurementTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-zone-measurement-label]'))
    .map((label) => label.textContent ?? '')
}

function createRuntimeWithAppPanelTargets(appAdapter?: CanvasRuntimeAppAdapter): SceneCanvasRuntime {
  return new SceneCanvasRuntime({
    appAdapter,
    targetPresentation: createAppSceneRuntimePanelTargetAdapter(),
  })
}

function lastCleanState(setCanvasClean: ReturnType<typeof vi.fn<(clean: boolean) => void>>): boolean | undefined {
  return setCanvasClean.mock.calls[setCanvasClean.mock.calls.length - 1]?.[0]
}

function createCleanStateAdapterProbe() {
  const setCanvasClean = vi.fn<(clean: boolean) => void>()
  return {
    adapter: {
      cleanState: { setCanvasClean },
      document: { composeDocumentForSave: composeTestDocumentForSave },
      settings: createTestSettingsAdapter(),
    } satisfies CanvasRuntimeAppAdapter,
    setCanvasClean,
  }
}

function createTestSettingsAdapter(
  overrides: Partial<CanvasRuntimeSettingsAdapter> = {},
): CanvasRuntimeSettingsAdapter {
  let gridVisible = false
  let rulersVisible = false
  let snapToGrid = false
  let snapToGuides = false
  let plantSpacingIntervalM = 0.5
  return {
    readLocale: () => 'en',
    readChromeOverlay: () => ({ gridVisible, rulersVisible }),
    readSnapToGridEnabled: () => snapToGrid,
    readSnapToGuidesEnabled: () => snapToGuides,
    readPlantSpacingIntervalMeters: () => plantSpacingIntervalM,
    commitPlantSpacingIntervalMeters: (meters) => {
      plantSpacingIntervalM = meters
    },
    toggleGridVisible: () => {
      gridVisible = !gridVisible
    },
    toggleSnapToGrid: () => {
      snapToGrid = !snapToGrid
    },
    toggleRulersVisible: () => {
      rulersVisible = !rulersVisible
    },
    subscribeTheme: (onChange) => {
      onChange()
      return () => {}
    },
    subscribeLocale: (onChange) => {
      onChange()
      return () => {}
    },
    subscribeChromeOverlay: (onChange) => {
      onChange()
      return () => {}
    },
    layerProjections: {
      isAppOwnedLayerProjection: (name) => name === 'base' || name === 'contours',
      syncFromLayers: () => {},
      syncLayer: () => {},
    },
    ...overrides,
  }
}

function composeTestDocumentForSave({
  metadata,
  document,
  canvas,
}: CanvasRuntimeDocumentCompositionInput): CanopiFile {
  return {
    ...document,
    ...canvas,
    name: metadata.name,
    description: metadata.description ?? document.description ?? null,
    location: normalizeTestMetadataLocation(metadata.location, document.location),
    north_bearing_deg: metadata.northBearingDeg ?? document.north_bearing_deg ?? 0,
    extra: {
      ...document.extra,
      ...canvas.extra,
    },
  }
}

function normalizeTestMetadataLocation(
  location: CanvasRuntimeDocumentCompositionInput['metadata']['location'],
  fallback: CanopiFile['location'],
): CanopiFile['location'] {
  if (!location) return fallback ?? null
  return {
    lat: location.lat,
    lon: location.lon,
    altitude_m: location.altitude_m ?? null,
  }
}

function createPanelTargetAdapterProbe(initialTargets: readonly PanelTarget[] = []) {
  let panelOriginTargets = initialTargets
  let canvasHoverTargets: readonly PanelTarget[] = []
  const subscribers = new Set<() => void>()
  const adapter: SceneRuntimePanelTargetAdapter = {
    readPanelOriginTargets: () => panelOriginTargets,
    setCanvasHoverTargets: (targets) => {
      canvasHoverTargets = [...targets]
    },
    clearPanelOriginTargets: () => {
      panelOriginTargets = []
      subscribers.forEach((notify) => notify())
    },
    subscribePanelOriginTargetChanges: (onChange) => {
      subscribers.add(onChange)
      return () => subscribers.delete(onChange)
    },
  }

  return {
    adapter,
    setPanelOriginTargets: (targets: readonly PanelTarget[]) => {
      panelOriginTargets = targets
      subscribers.forEach((notify) => notify())
    },
    get canvasHoverTargets() {
      return canvasHoverTargets
    },
    get panelOriginTargets() {
      return panelOriginTargets
    },
  }
}

describe('scene canvas runtime', () => {
  beforeEach(() => {
    activeTool.value = 'select'
    locale.value = 'en'
    selectedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
    clearPlantStampSource()
    snapToGridEnabled.value = false
    guides.value = []
    hoveredCanvasTargets.value = []
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
    layerVisibility.value = {}
    layerLockState.value = {}
    layerOpacity.value = {}
    plantSizeMode.value = 'default'
    plantColorByAttr.value = null
    plantSpacingIntervalM.value = 0.5
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
        locked: false,
      },
    ]
    file.zones = file.zones.map((zone) =>
      zone.name === 'zone-1' ? { ...zone, locked: true } : zone,
    )
    runtime.loadDocument(file)

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
        locked: false,
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
    const runtime = new SceneCanvasRuntime({
      appAdapter: createAppCanvasRuntimeAppAdapter(),
    })

    runtime.toggleSnapToGrid()
    expect(snapToGridEnabled.value).toBe(true)

    runtime.toggleSnapToGrid()
    expect(snapToGridEnabled.value).toBe(false)

    runtime.destroy()
  })

  it('routes settings-backed canvas commands through the injected app adapter', () => {
    const adapterProbe = createCleanStateAdapterProbe()
    const toggleGridVisible = vi.fn()
    const toggleSnapToGrid = vi.fn()
    const toggleRulersVisible = vi.fn()
    const runtime = new SceneCanvasRuntime({
      appAdapter: {
        ...adapterProbe.adapter,
        settings: createTestSettingsAdapter({
          toggleGridVisible,
          toggleSnapToGrid,
          toggleRulersVisible,
        }),
      },
    })

    runtime.toggleGrid()
    runtime.toggleSnapToGrid()
    runtime.toggleRulers()

    expect(toggleGridVisible).toHaveBeenCalledTimes(1)
    expect(toggleSnapToGrid).toHaveBeenCalledTimes(1)
    expect(toggleRulersVisible).toHaveBeenCalledTimes(1)
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

  it('bumps query viewport revision on viewport-only camera changes', async () => {
    const runtime = new SceneCanvasRuntime()
    await initRuntimeWithStubbedRenderer(runtime)

    const before = runtime.revision.viewport.value
    runtime.zoomIn()

    expect(runtime.revision.viewport.value).toBeGreaterThan(before)
  })

  it('skips stale presentation backfills after scene revision changes', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeFile())

    const applyPresentationBackfills = vi.spyOn(
      (runtime as any)._documents,
      'applyPresentationBackfills',
    )
    let resolveRefresh!: (value: { changed: boolean; backfills: Array<{ plantId: string; stratum: string | null; canopySpreadM: number | null; scale: number | null }> | null }) => void
    const pendingRefresh = new Promise<{ changed: boolean; backfills: Array<{ plantId: string; stratum: string | null; canopySpreadM: number | null; scale: number | null }> | null }>((resolve) => {
      resolveRefresh = resolve
    })
    ;(runtime as any)._presentation.refreshSpeciesCacheEntries = vi.fn(() => pendingRefresh)

    const pending = runtime.ensureSpeciesCacheEntries(['Malus domestica'], 'en')
    runtime.setPlantColorForSpecies('Malus domestica', '#335577')
    resolveRefresh({
      changed: true,
      backfills: [{
        plantId: 'plant-1',
        stratum: 'canopy',
        canopySpreadM: 4,
        scale: 4,
      }],
    })

    await expect(pending).resolves.toBe(false)
    expect(applyPresentationBackfills).not.toHaveBeenCalled()
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

  it('refreshes Zone Measurements when runtime selection changes', async () => {
    const runtime = new SceneCanvasRuntime()
    const file = makeFile()
    file.zones = [{
      name: 'zone-1',
      zone_type: 'rect',
      points: [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 90 },
        { x: 10, y: 90 },
      ],
      fill_color: null,
      notes: null,
      locked: false,
    }]
    runtime.loadDocument(file)
    const { container } = await initRuntimeWithStubbedRenderer(runtime)

    runtime.setSelection(['zone-1'])

    expect(zoneMeasurementTexts(container)).toEqual([
      '100 m',
      '80 m',
      '100 m',
      '80 m',
      '8000 m²',
    ])

    runtime.clearSelection()

    expect(zoneMeasurementTexts(container)).toEqual([])
    runtime.destroy()
  })

  it('resolves hovered panel targets for renderer highlights without mutating selection', async () => {
    const runtime = createRuntimeWithAppPanelTargets()
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
    const cleanState = createCleanStateAdapterProbe()
    const runtime = createRuntimeWithAppPanelTargets(cleanState.adapter)
    runtime.loadDocument(makeFile())
    cleanState.setCanvasClean.mockClear()
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
    expect(cleanState.setCanvasClean).not.toHaveBeenCalledWith(false)
    runtime.destroy()
  })

  it('keeps typed panel target highlights separate when plant IDs and zone names collide', async () => {
    const runtime = createRuntimeWithAppPanelTargets()
    runtime.loadDocument({
      ...makeFile(),
      plants: [
        {
          ...makeFile().plants[0]!,
          id: 'colliding-id',
          canonical_name: 'Malus domestica',
          locked: false,
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
    const runtime = createRuntimeWithAppPanelTargets()
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

  it('uses the injected panel target adapter for highlights and canvas-origin hover', async () => {
    const panelTargetProbe = createPanelTargetAdapterProbe()
    const runtime = new SceneCanvasRuntime({ targetPresentation: panelTargetProbe.adapter })
    runtime.loadDocument(makeFile())
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    renderer.renderScene.mockClear()
    panelTargetProbe.setPanelOriginTargets([speciesTarget('Malus domestica')])

    await vi.waitFor(() => {
      expect(renderer.renderScene).toHaveBeenCalled()
    })

    const snapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
    expect(snapshot?.highlightedPlantIds).toEqual(new Set(['plant-1', 'plant-2']))

    ;(runtime as any)._interaction._deps.setHoveredEntityId('plant-1')
    expect(panelTargetProbe.canvasHoverTargets).toEqual([speciesTarget('Malus domestica')])

    panelTargetProbe.setPanelOriginTargets([{ kind: 'zone', zone_name: 'zone-1' }])
    runtime.replaceDocument(makeFile())
    expect(panelTargetProbe.panelOriginTargets).toEqual([])
    runtime.destroy()
  })

  it('reports canvas clean-state transitions through the injected app adapter', () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = new SceneCanvasRuntime({ appAdapter: cleanState.adapter })
    const file = makeFile()

    runtime.loadDocument(file)
    runtime.markSaved()
    cleanState.setCanvasClean.mockClear()

    runtime.setSelection(['plant-1'])
    runtime.lockSelected()
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)

    runtime.undo()
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(true)

    runtime.redo()
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)

    runtime.markSaved()
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(true)

    runtime.clearHistory()
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(true)
  })

  it('delegates Design file composition through the injected app adapter', () => {
    const composeDocumentForSave = vi.fn(({
      metadata,
      document,
      canvas,
    }: CanvasRuntimeDocumentCompositionInput) => ({
      ...document,
      ...canvas,
      name: metadata.name,
      description: 'composed by adapter',
    } as CanopiFile))
    const runtime = new SceneCanvasRuntime({
      appAdapter: {
        cleanState: { setCanvasClean: () => {} },
        document: { composeDocumentForSave },
        settings: createTestSettingsAdapter(),
      },
    })
    const file = makeFile()

    runtime.loadDocument(file)
    runtime.setSelection(['plant-1'])
    runtime.setSelectedPlantColor('#228833')

    const serialized = runtime.serializeDocument({ name: 'Adapter save' }, file)

    expect(composeDocumentForSave).toHaveBeenCalledTimes(1)
    const input = composeDocumentForSave.mock.calls[0]?.[0]
    expect(input?.metadata).toEqual({ name: 'Adapter save' })
    expect(input?.document).toBe(file)
    expect(input?.canvas.plants[0]?.color).toBe('#228833')
    expect(serialized.description).toBe('composed by adapter')
  })

  it('preserves document-owned fields when serializing with the detached runtime adapter', () => {
    const runtime = new SceneCanvasRuntime()
    const file = {
      ...makeFile(),
      description: 'Loaded description',
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 18,
      consortiums: [{
        target: { kind: 'species', canonical_name: 'Malus domestica' },
        stratum: 'canopy',
        start_phase: 1,
        end_phase: 3,
      }],
      timeline: [{
        id: 'action-1',
        action_type: 'prune',
        description: 'Winter prune',
        start_date: '2026-12-01',
        end_date: null,
        recurrence: null,
        targets: [{ kind: 'species', canonical_name: 'Malus domestica' }],
        depends_on: null,
        completed: false,
        order: 0,
      }],
      budget: [{
        target: { kind: 'manual' },
        category: 'tools',
        description: 'Pruning saw',
        quantity: 1,
        unit_cost: 35,
        currency: 'EUR',
      }],
      budget_currency: 'USD',
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-02-01T00:00:00.000Z',
      extra: {
        imported_from: 'legacy-plan',
      },
    } satisfies CanopiFile

    runtime.loadDocument(file)
    runtime.setSelection(['plant-1'])
    runtime.setSelectedPlantColor('#228833')

    const serialized = runtime.serializeDocument({ name: 'Detached save' }, file)

    expect(serialized.name).toBe('Detached save')
    expect(serialized.description).toBe('Loaded description')
    expect(serialized.location).toEqual({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })
    expect(serialized.north_bearing_deg).toBe(18)
    expect(serialized.consortiums).toEqual(file.consortiums)
    expect(serialized.timeline).toEqual(file.timeline)
    expect(serialized.budget).toEqual(file.budget)
    expect(serialized.budget_currency).toBe('USD')
    expect(serialized.created_at).toBe('2025-01-01T00:00:00.000Z')
    expect(serialized.extra).toEqual({ imported_from: 'legacy-plan' })
    expect(serialized.plants[0]?.color).toBe('#228833')
  })

  it('publishes canvas-origin species hover targets without mutating selection', async () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = createRuntimeWithAppPanelTargets(cleanState.adapter)
    runtime.loadDocument(makeFile())
    cleanState.setCanvasClean.mockClear()
    await initRuntimeWithStubbedRenderer(runtime)

    ;(runtime as any)._interaction._deps.setHoveredEntityId('plant-1')

    expect(hoveredCanvasTargets.value).toEqual([speciesTarget('Malus domestica')])
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(cleanState.setCanvasClean).not.toHaveBeenCalledWith(false)

    ;(runtime as any)._interaction._deps.setHoveredEntityId(null)

    expect(hoveredCanvasTargets.value).toEqual([])
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(cleanState.setCanvasClean).not.toHaveBeenCalledWith(false)
    runtime.destroy()
  })

  it('clears canvas-origin hover during destroy without rendering into a disposing renderer', async () => {
    const runtime = createRuntimeWithAppPanelTargets()
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
    const initialRevision = runtime.revision.viewport.value

    runtime.zoomIn()
    expect(runtime.revision.viewport.value).toBe(initialRevision + 1)

    runtime.resize(400, 300)
    expect(runtime.revision.viewport.value).toBe(initialRevision + 2)
    runtime.destroy()
  })

  it('resets transient runtime state before replacing the document', async () => {
    const runtime = createRuntimeWithAppPanelTargets()
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    runtime.loadDocument(makeFile())
    runtime.setTool('plant-stamp')
    activeTool.value = 'plant-stamp'
    selectPlantStampSource({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })
    plantColorMenuOpen.value = true
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
    expect(readPlantStampSource()).toBe(null)
    expect(plantColorMenuOpen.value).toBe(false)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(hoveredPanelTargets.value).toEqual([])
    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
    runtime.destroy()
  })

  it('records Object Stamp plant placement in history without replacing the clipboard', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    Object.defineProperty(container, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
      }),
    })
    runtime.loadDocument(makeFile())
    ;(runtime as any)._camera.setViewport({ x: 0, y: 0, scale: 1 })
    runtime.getSceneStore().setViewport({ x: 0, y: 0, scale: 1 })

    runtime.setSelection(['plant-2'])
    runtime.copy()
    runtime.setTool('object-stamp')

    const interaction = (runtime as any)._interaction
    interaction._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    interaction._onPointerDown(new MouseEvent('pointerdown', { clientX: 30, clientY: 30, button: 0 }))

    expect(runtime.getSceneStore().persisted.plants).toHaveLength(3)
    const stampedId = runtime.getSceneStore().persisted.plants[2]!.id
    expect(selectedObjectIds.value).toEqual(new Set([stampedId]))

    runtime.undo()
    expect(runtime.getSceneStore().persisted.plants).toHaveLength(2)

    runtime.paste()
    const pasted = runtime.getSceneStore().persisted.plants[2]!
    expect(pasted.canonicalName).toBe('Malus domestica')
    expect(pasted.position).toEqual({ x: 40, y: 40 })
    runtime.destroy()
  })

  it('records Object Stamp group placement as one undoable edit with cloned members', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    Object.defineProperty(container, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
      }),
    })
    const file = makeFile()
    file.groups = [{
      id: 'group-1',
      name: 'Pair',
      layer: 'plants',
      position: { x: 10, y: 10 },
      rotation: null,
      member_ids: ['plant-1', 'plant-2'],
      locked: false,
    }]
    runtime.loadDocument(file)
    ;(runtime as any)._camera.setViewport({ x: 0, y: 0, scale: 1 })
    runtime.getSceneStore().setViewport({ x: 0, y: 0, scale: 1 })
    runtime.setTool('object-stamp')

    const interaction = (runtime as any)._interaction
    interaction._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    interaction._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0 }))

    expect(runtime.getSceneStore().persisted.groups).toHaveLength(2)
    expect(runtime.getSceneStore().persisted.plants).toHaveLength(4)
    const stampedGroup = runtime.getSceneStore().persisted.groups[1]!
    expect(selectedObjectIds.value).toEqual(new Set([stampedGroup.id]))
    expect(stampedGroup.memberIds).toHaveLength(2)
    expect(stampedGroup.memberIds).not.toContain('plant-1')
    expect(stampedGroup.memberIds).not.toContain('plant-2')

    runtime.undo()
    expect(runtime.getSceneStore().persisted.groups).toHaveLength(1)
    expect(runtime.getSceneStore().persisted.plants).toHaveLength(2)
    runtime.destroy()
  })

  it('records Plant Spacing commit as one undoable scene edit', async () => {
    const cleanState = createCleanStateAdapterProbe()
    cleanState.adapter.settings.commitPlantSpacingIntervalMeters(5)
    const runtime = new SceneCanvasRuntime({ appAdapter: cleanState.adapter })
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    Object.defineProperty(container, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
      }),
    })
    runtime.loadDocument(makeFile())
    ;(runtime as any)._camera.setViewport({ x: 0, y: 0, scale: 1 })
    runtime.getSceneStore().setViewport({ x: 0, y: 0, scale: 1 })
    runtime.setTool('plant-spacing')

    const interaction = (runtime as any)._interaction
    interaction._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    interaction._onPointerMove(new MouseEvent('pointermove', { clientX: 20, clientY: 10, button: 0 }))
    interaction._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 10, button: 0 }))

    expect(runtime.getSceneStore().persisted.plants).toHaveLength(4)
    expect(runtime.canUndo.value).toBe(true)

    runtime.undo()
    expect(runtime.getSceneStore().persisted.plants).toHaveLength(2)
    expect(runtime.canRedo.value).toBe(true)

    runtime.redo()
    expect(runtime.getSceneStore().persisted.plants).toHaveLength(4)
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

  it('locks and unlocks selected Design Objects through scene edit history and serialization', () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = new SceneCanvasRuntime({ appAdapter: cleanState.adapter })
    const file = makeFile()
    runtime.loadDocument(file)
    runtime.markSaved()
    cleanState.setCanvasClean.mockClear()

    runtime.setSelection(['plant-1'])
    runtime.lockSelected()

    expect(runtime.serializeDocument({ name: file.name }, file).plants.find((plant) => plant.id === 'plant-1')?.locked)
      .toBe(true)
    expect(runtime.getSelection().size).toBe(0)
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)
    expect(runtime.canUndo.value).toBe(true)

    runtime.undo()
    expect(runtime.serializeDocument({ name: file.name }, file).plants.find((plant) => plant.id === 'plant-1')?.locked)
      .toBe(false)

    runtime.redo()
    expect(runtime.serializeDocument({ name: file.name }, file).plants.find((plant) => plant.id === 'plant-1')?.locked)
      .toBe(true)

    runtime.setSelection(['plant-1'])
    runtime.unlockSelected()
    expect(runtime.serializeDocument({ name: file.name }, file).plants.find((plant) => plant.id === 'plant-1')?.locked)
      .toBe(false)
  })

  it('edits layer state through the scene edit history and projection signals', () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = new SceneCanvasRuntime({
      appAdapter: {
        ...cleanState.adapter,
        settings: createAppCanvasRuntimeAppAdapter().settings,
      },
    })
    const file = makeFile()
    runtime.loadDocument(file)
    runtime.markSaved()
    cleanState.setCanvasClean.mockClear()

    expect(runtime.setSceneLayerVisibility('plants', false)).toBe(true)
    expect(runtime.setSceneLayerOpacity('zones', 0.4)).toBe(true)
    expect(runtime.setSceneLayerLocked('zones', true)).toBe(true)

    const serialized = runtime.serializeDocument({ name: file.name }, file)

    expect(serialized.layers.find((layer) => layer.name === 'plants')?.visible).toBe(false)
    expect(serialized.layers.find((layer) => layer.name === 'zones')?.opacity).toBe(0.4)
    expect(serialized.layers.find((layer) => layer.name === 'zones')?.locked).toBe(true)
    expect(layerVisibility.value.plants).toBe(false)
    expect(layerOpacity.value.zones).toBe(0.4)
    expect(layerLockState.value.zones).toBe(true)
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)
    expect(runtime.canUndo.value).toBe(true)

    runtime.undo()
    expect(runtime.serializeDocument({ name: file.name }, file).layers.find((layer) => layer.name === 'zones')?.locked)
      .toBe(false)
    expect(layerLockState.value.zones).toBe(false)

    runtime.redo()
    expect(runtime.serializeDocument({ name: file.name }, file).layers.find((layer) => layer.name === 'zones')?.locked)
      .toBe(true)
    expect(layerLockState.value.zones).toBe(true)

    runtime.destroy()
  })

  it('edits guides through the scene edit history and projection signals', () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = new SceneCanvasRuntime({ appAdapter: cleanState.adapter })
    const file = makeFile()
    runtime.loadDocument(file)
    runtime.markSaved()
    cleanState.setCanvasClean.mockClear()

    ;(runtime as any)._addGuide('v', 42)

    const serialized = runtime.serializeDocument({ name: file.name }, file)
    expect(serialized.extra).toEqual({
      guides: [{ id: expect.any(String), axis: 'v', position: 42 }],
    })
    expect(guides.value).toEqual([{ id: expect.any(String), axis: 'v', position: 42 }])
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)

    runtime.undo()
    expect(runtime.serializeDocument({ name: file.name }, file).extra).toEqual({})
    expect(guides.value).toEqual([])
  })

  it('marks the canvas dirty when only the species default color changes', () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = new SceneCanvasRuntime({ appAdapter: cleanState.adapter })
    const file = makeFile()
    file.plant_species_colors = {
      'Malus domestica': '#112233',
    }
    file.plants[0]!.color = '#C44230'
    file.plants[1]!.color = '#C44230'
    runtime.loadDocument(file)
    runtime.markSaved()
    cleanState.setCanvasClean.mockClear()

    const changed = runtime.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(0)
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)
    expect(runtime.serializeDocument({ name: file.name }, file).plant_species_colors).toEqual({
      'Malus domestica': '#C44230',
    })
  })

  it('refreshes localized common names in renderer snapshots when the active locale changes', async () => {
    vi.mocked(getCommonNames)
      .mockResolvedValueOnce({ 'Malus domestica': 'Apple' })
      .mockResolvedValueOnce({ 'Malus domestica': 'Pommier' })

    const runtime = new SceneCanvasRuntime({
      appAdapter: createAppCanvasRuntimeAppAdapter(),
    })
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
