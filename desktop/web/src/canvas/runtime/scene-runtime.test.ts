import { effect } from '@preact/signals'
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
import {
  clearPlantStampSource,
  readPlantStampSource,
  selectPlantStampSource,
} from '../plant-stamp-source'
import {
  clearSavedObjectStampSource,
  selectSavedObjectStampSource,
} from '../saved-object-stamp-source'
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
import {
  CanvasDocumentReplacementNotAdmittedError,
  createCanvasDocumentReplacementToken,
} from './runtime'
import { SceneCanvasRuntime } from './scene-runtime.ts'
import type { PlantNameLabel } from './selection-labels'
import type { SceneRuntimePanelTargetAdapter } from './scene-runtime/panel-target-adapter'
import type { ScenePresentationRefreshResult } from './scene-runtime/presentation'
import {
  SceneEditBusyError,
  type SceneEditCoordinator,
  type SceneEditTransaction,
} from './scene-runtime/transactions'
import type {
  CanvasRuntimeAppAdapter,
  CanvasRuntimeDocumentCompositionInput,
  CanvasRuntimeSettingsAdapter,
} from './app-adapter'
import { getCommonNames } from '../../ipc/species'
import { createSceneInteractionEventHarness } from '../../__tests__/support/scene-interaction-events'

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

function fileWithOnlyPlants(...ids: string[]): CanopiFile {
  const file = makeFile()
  return {
    ...file,
    plants: file.plants.filter((plant) => ids.includes(plant.id)),
    zones: [],
    annotations: [],
    groups: [],
  }
}

function fileWithOnlyAnnotation(text: string): CanopiFile {
  const file = makeFile()
  return {
    ...file,
    plants: [],
    zones: [],
    annotations: [{
      id: 'annotation-1',
      annotation_type: 'text',
      position: { x: 24, y: 32 },
      text,
      font_size: 20,
      rotation: null,
      locked: false,
    }],
    groups: [],
    layers: [
      { name: 'annotations', visible: true, locked: false, opacity: 1 },
    ],
  }
}

function fileWithOnlyZone(zone: CanopiFile['zones'][number] = makeFile().zones[0]!): CanopiFile {
  const file = makeFile()
  return {
    ...file,
    plants: [],
    zones: [zone],
    annotations: [],
    groups: [],
  }
}

type TestMeasurementGuideFileEntity = NonNullable<CanopiFile['measurement_guides']>[number]

function fileWithMeasurementGuide(overrides: Partial<TestMeasurementGuideFileEntity> = {}): CanopiFile {
  const file = makeFile()
  return {
    ...file,
    plants: [],
    zones: [],
    annotations: [],
    groups: [],
    layers: [
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
      { name: 'annotations', visible: true, locked: false, opacity: 1 },
      { name: 'measurement-guides', visible: true, locked: false, opacity: 1 },
    ],
    measurement_guides: [{
      id: 'measurement-guide-1',
      locked: false,
      start: { x: 10, y: 10 },
      end: { x: 40, y: 10 },
      ...overrides,
    }],
  }
}

function fileWithGroupedPair(): CanopiFile {
  const file = makeFile()
  file.zones = []
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
  return file
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

function createRuntimeContainer(): HTMLDivElement {
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
  return container
}

async function initRuntimeWithStubbedRenderer(runtime: SceneCanvasRuntime) {
  const container = createRuntimeContainer()

  const renderer = createRendererStub()
  ;(runtime as any)._construction.replaceRendererHost({
    initialize: async () => renderer,
    run: async (operation: (instance: typeof renderer) => unknown) => operation(renderer),
    dispose: async () => {},
  })

  await runtime.init(container)
  return { container, renderer }
}

function setInteractionViewport(
  runtime: SceneCanvasRuntime,
  viewport: { x: number; y: number; scale: number } = { x: 0, y: 0, scale: 1 },
): void {
  ;(runtime as any)._camera.setViewport(viewport)
  runtime.documentSurface.resize(400, 300)
}

function clickAt(
  events: ReturnType<typeof createSceneInteractionEventHarness>,
  point: { x: number; y: number },
): void {
  events.pointerDown(point)
  events.pointerUp(point)
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
    clearSavedObjectStampSource()
    snapToGridEnabled.value = false
    guides.value = []
    hoveredCanvasTargets.value = []
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
    layerVisibility.value = {}
    layerLockState.value = {}
    layerOpacity.value = {}
    plantSpacingIntervalM.value = 0.5
    vi.mocked(getCommonNames).mockReset()
    vi.mocked(getCommonNames).mockResolvedValue({})
  })

  it('rolls back effects acquired before a later subscription fails', () => {
    const disposeTheme = vi.fn()
    const disposeLocale = vi.fn(() => {
      throw new Error('locale disposal failed')
    })
    const disposeChromeOverlay = vi.fn()
    const cleanState = createCleanStateAdapterProbe()
    const panelTargets = createPanelTargetAdapterProbe()

    expect(() => new SceneCanvasRuntime({
      appAdapter: {
        ...cleanState.adapter,
        settings: createTestSettingsAdapter({
          subscribeTheme: () => disposeTheme,
          subscribeLocale: () => disposeLocale,
          subscribeChromeOverlay: () => disposeChromeOverlay,
        }),
      },
      targetPresentation: {
        ...panelTargets.adapter,
        subscribePanelOriginTargetChanges: () => {
          throw new Error('panel subscription failed')
        },
      },
    })).toThrow('Scene Canvas runtime effect installation failed')

    expect(disposeTheme).toHaveBeenCalledTimes(1)
    expect(disposeLocale).toHaveBeenCalledTimes(1)
    expect(disposeChromeOverlay).toHaveBeenCalledTimes(1)
  })

  it('runs every installed effect disposer when one disposer fails', () => {
    const disposeTheme = vi.fn(() => {
      throw new Error('theme disposal failed')
    })
    const disposeLocale = vi.fn()
    const disposeChromeOverlay = vi.fn()
    const disposePanelTarget = vi.fn()
    const cleanState = createCleanStateAdapterProbe()
    const panelTargets = createPanelTargetAdapterProbe()
    const runtime = new SceneCanvasRuntime({
      appAdapter: {
        ...cleanState.adapter,
        settings: createTestSettingsAdapter({
          subscribeTheme: () => disposeTheme,
          subscribeLocale: () => disposeLocale,
          subscribeChromeOverlay: () => disposeChromeOverlay,
        }),
      },
      targetPresentation: {
        ...panelTargets.adapter,
        subscribePanelOriginTargetChanges: () => disposePanelTarget,
      },
    })

    expect(() => runtime.destroy()).toThrow('theme disposal failed')

    expect(disposeTheme).toHaveBeenCalledTimes(1)
    expect(disposeLocale).toHaveBeenCalledTimes(1)
    expect(disposeChromeOverlay).toHaveBeenCalledTimes(1)
    expect(disposePanelTarget).toHaveBeenCalledTimes(1)
  })

  it('publishes a tool change only after the live Session transition succeeds', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    const sceneEdits = (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
    const beginSceneEdit = sceneEdits.begin.bind(sceneEdits)
    let abortCalls = 0
    const beginSpy = vi.spyOn(sceneEdits, 'begin').mockImplementation((type: string) => {
      const transaction = beginSceneEdit(type)
      if (type !== 'interaction-drag') return transaction
      return {
        mutate: (edit) => transaction.mutate(edit),
        setSelection: (ids: Iterable<string>) => transaction.setSelection(ids),
        commit: (options) => transaction.commit(options),
        get changed() {
          return transaction.changed
        },
        abort: () => {
          abortCalls += 1
          if (abortCalls === 1) throw new Error('drag abort failed')
          transaction.abort()
        },
      } satisfies SceneEditTransaction
    })

    events.pointerDown({ x: 10, y: 10 }, { pointerId: 51 })
    events.pointerMove({ x: 30, y: 30 }, { pointerId: 51 })

    expect(() => runtime.commandSurface.tools.setTool('rectangle'))
      .toThrow('drag abort failed')
    expect(activeTool.value).toBe('select')
    expect(container.style.cursor).toBe('default')

    runtime.commandSurface.tools.setTool('rectangle')

    expect(abortCalls).toBe(2)
    expect(activeTool.value).toBe('rectangle')
    expect(container.style.cursor).toBe('crosshair')

    beginSpy.mockRestore()
    events.dispose()
    runtime.destroy()
  })

  it('retries interaction cancellation before replacing a document', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    const sceneEdits = (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
    const beginSceneEdit = sceneEdits.begin.bind(sceneEdits)
    let abortCalls = 0
    const beginSpy = vi.spyOn(sceneEdits, 'begin').mockImplementation((type: string) => {
      const transaction = beginSceneEdit(type)
      if (type !== 'interaction-drag') return transaction
      return {
        mutate: (edit) => transaction.mutate(edit),
        setSelection: (ids: Iterable<string>) => transaction.setSelection(ids),
        commit: (options) => transaction.commit(options),
        get changed() {
          return transaction.changed
        },
        abort: () => {
          abortCalls += 1
          if (abortCalls === 1) throw new Error('drag abort failed')
          transaction.abort()
        },
      } satisfies SceneEditTransaction
    })
    const replacementToken = createCanvasDocumentReplacementToken()

    try {
      events.pointerDown({ x: 10, y: 10 }, { pointerId: 61 })
      events.pointerMove({ x: 30, y: 30 }, { pointerId: 61 })

      expect(() => runtime.documentSurface.replaceDocument(
        fileWithOnlyPlants('plant-2'),
        replacementToken,
        () => {},
      ))
        .toThrow('drag abort failed')
      expect(runtime.querySurface.getSceneSnapshot().plants.map((plant) => plant.id))
        .toEqual(['plant-1'])

      runtime.documentSurface.replaceDocument(
        fileWithOnlyPlants('plant-2'),
        replacementToken,
        () => {},
      )

      expect(abortCalls).toBe(2)
      expect(runtime.querySurface.getSceneSnapshot().plants).toEqual([
        expect.objectContaining({ id: 'plant-2', position: { x: 20, y: 20 } }),
      ])

      events.pointerUp({ x: 30, y: 30 }, { pointerId: 61 })
      expect(runtime.querySurface.getSceneSnapshot().plants).toEqual([
        expect.objectContaining({ id: 'plant-2', position: { x: 20, y: 20 } }),
      ])
    } finally {
      beginSpy.mockRestore()
      events.dispose()
      runtime.destroy()
    }
  })

  it('reserves replacement authority before a live gesture releases', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')
    let admitReleaseObserver = false
    let attemptingAdmission = false
    const committedScenes: string[][] = []
    const dispose = effect(() => {
      const settledPlants = runtime.querySurface.getSettledPlacedPlants()
      if (!admitReleaseObserver || !settledPlants || attemptingAdmission) return
      attemptingAdmission = true
      try {
        const changed = runtime.commandSurface.plantPresentation.setPlantColorForSpecies(
          'Malus domestica',
          '#335577',
        )
        if (changed > 0) {
          committedScenes.push(settledPlants.map((plant) => plant.id))
          admitReleaseObserver = false
        }
      } finally {
        attemptingAdmission = false
      }
    })

    try {
      events.pointerDown({ x: 10, y: 10 }, { pointerId: 62 })
      events.pointerMove({ x: 30, y: 30 }, { pointerId: 62 })
      admitReleaseObserver = true

      runtime.documentSurface.replaceDocument(
        fileWithOnlyPlants('plant-2'),
        createCanvasDocumentReplacementToken(),
        () => {},
      )

      expect(committedScenes).toEqual([['plant-2']])
      expect(runtime.querySurface.getSceneSnapshot().plantSpeciesColors)
        .toEqual({ 'Malus domestica': '#335577' })
      expect(runtime.commandSurface.history.canUndo.value).toBe(true)
      runtime.commandSurface.history.undo()
      expect(runtime.querySurface.getSceneSnapshot().plantSpeciesColors).toEqual({})
    } finally {
      dispose()
      events.dispose()
      runtime.destroy()
    }
  })

  it('cannot commit an old Annotation editor into a replacement document', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithOnlyAnnotation('Old document'))
    setInteractionViewport(runtime)
    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const oldTextarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    oldTextarea.value = 'Stale draft'

    runtime.documentSurface.replaceDocument(
      fileWithOnlyAnnotation('New document'),
      createCanvasDocumentReplacementToken(),
      () => {},
    )
    oldTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(container.querySelector('textarea')).toBeNull()
    expect(runtime.querySurface.getSceneSnapshot().annotations[0]?.text).toBe('New document')
    events.dispose()
    runtime.destroy()
  })

  it('cannot invoke an old Context Menu action against a replacement document', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    setInteractionViewport(runtime)
    runtime.commandSurface.sceneEdits.selectAll()
    const point = events.clientPoint({ x: 200, y: 180 })
    container.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    }))
    const remove = container.querySelector<HTMLButtonElement>(
      '[data-canvas-context-command="delete"]',
    )!
    remove.focus()

    runtime.documentSurface.replaceDocument(
      fileWithOnlyPlants('plant-2'),
      createCanvasDocumentReplacementToken(),
      () => {},
    )
    remove.click()

    expect(runtime.querySurface.getSceneSnapshot().plants.map((plant) => plant.id))
      .toEqual(['plant-2'])
    expect(container.querySelector<HTMLElement>('[data-canvas-context-menu]')?.style.display)
      .toBe('none')
    expect(document.activeElement).not.toBe(remove)
    events.dispose()
    runtime.destroy()
  })

  it('restores the live Session tool when post-transition refresh fails', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('hand')
    events.pointerDown({ x: 100, y: 100 }, { pointerId: 52 })
    events.pointerMove({ x: 110, y: 110 }, { pointerId: 52 })
    expect(container.style.cursor).toBe('grabbing')
    const selection = vi.spyOn(runtime.querySurface, 'getDesignObjectSelection')
      .mockImplementation(() => {
        throw new Error('selection refresh failed')
      })

    expect(() => runtime.commandSurface.tools.setTool('select'))
      .toThrow('selection refresh failed')
    expect(activeTool.value).toBe('hand')
    expect(container.style.cursor).toBe('grab')

    selection.mockRestore()
    const beforeFreshPan = runtime.querySurface.viewport.value.viewport
    events.pointerDown({ x: 100, y: 100 }, { pointerId: 53 })
    events.pointerMove({ x: 130, y: 120 }, { pointerId: 53 })
    events.pointerUp({ x: 130, y: 120 }, { pointerId: 53 })

    expect(runtime.querySurface.viewport.value.viewport).toMatchObject({
      x: beforeFreshPan.x + 30,
      y: beforeFreshPan.y + 20,
    })
    events.dispose()
    runtime.destroy()
  })

  it('restores the previous tool adapter when post-transition refresh fails', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('plant-spacing')
    const selection = vi.spyOn(runtime.querySurface, 'getDesignObjectSelection')
      .mockImplementation(() => {
        throw new Error('selection refresh failed')
      })

    expect(() => runtime.commandSurface.tools.setTool('select'))
      .toThrow('selection refresh failed')
    expect(activeTool.value).toBe('plant-spacing')
    const plantSpacingHud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')
    expect(plantSpacingHud?.style.display).toBe('block')
    expect(plantSpacingHud?.textContent).toContain('Select a placed plant')

    selection.mockRestore()
    clickAt(events, { x: 10, y: 10 })

    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    events.dispose()
    runtime.destroy()
  })

  it('blocks history while a long-lived Scene Edit owns the Scene', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    const sceneEdits = (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
    sceneEdits.run('move-before-drag', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position.x = 20
      })
    })
    const active = sceneEdits.begin('interaction-drag')
    active.mutate((draft) => {
      draft.plants[0]!.position.x = 30
    })

    expect(runtime.commandSurface.history.canUndo.value).toBe(false)
    runtime.commandSurface.history.undo()

    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.position.x).toBe(30)
    active.abort()
    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.position.x).toBe(20)
    expect(runtime.commandSurface.history.canUndo.value).toBe(true)
    runtime.commandSurface.history.undo()
    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.position.x).toBe(10)
    runtime.destroy()
  })

  it('retries a quarantined history replay through the public command surface', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    const sceneEdits = (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
    sceneEdits.run('move-before-undo', (tx) => {
      tx.mutate((draft) => {
        draft.plants[0]!.position.x = 20
      })
    })
    const invalidate = vi.spyOn(runtime as any, '_invalidate')
      .mockImplementationOnce(() => {
        throw new Error('history render publication failed')
      })

    expect(() => runtime.commandSurface.history.undo())
      .toThrow('history render publication failed')
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(runtime.commandSurface.history.canUndo.value).toBe(false)
    expect(runtime.commandSurface.history.canRedo.value).toBe(false)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.position.x).toBe(10)

    runtime.commandSurface.history.undo()

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(runtime.commandSurface.history.canUndo.value).toBe(false)
    expect(runtime.commandSurface.history.canRedo.value).toBe(true)
    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.position.x).toBe(10)
    invalidate.mockRestore()
    runtime.destroy()
  })

  it('admits whole Scene commands only while the Scene is settled', () => {
    const runtime = new SceneCanvasRuntime()
    const file = fileWithOnlyPlants('plant-1', 'plant-2')
    file.plant_species_colors['Malus domestica'] = '#335577'
    runtime.documentSurface.loadDocument(file)
    const sceneEdits = (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
    sceneEdits.run('seed-selection', (tx) => {
      tx.setSelection(['plant-1'])
    })
    runtime.commandSurface.sceneEdits.copy()
    expect(runtime.commandSurface.sceneEdits.canPaste()).toBe(true)
    const active = sceneEdits.begin('interaction-drag')
    active.mutate((draft) => {
      draft.plants[1]!.canonicalName = 'Pyrus communis'
    })
    active.setSelection(['plant-2'])

    runtime.commandSurface.sceneEdits.selectAll()
    runtime.commandSurface.sceneEdits.copy()
    runtime.commandSurface.sceneEdits.paste()

    expect(runtime.querySurface.getSelection()).toEqual(new Set(['plant-2']))
    expect(runtime.querySurface.getSettledPlacedPlants()).toBeNull()
    expect(runtime.commandSurface.sceneEdits.canPaste()).toBe(false)
    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(2)
    expect(runtime.commandSurface.layers.setSceneLayerVisibility('plants', false)).toBe(false)
    expect(runtime.commandSurface.plantPresentation.clearPlantSpeciesColor('Malus domestica')).toBe(false)
    expect(runtime.querySurface.getSceneSnapshot().layers.find((layer) => layer.name === 'plants')?.visible)
      .toBe(true)
    expect(runtime.querySurface.getSceneSnapshot().plantSpeciesColors['Malus domestica'])
      .toBe('#335577')
    active.abort()
    expect(runtime.querySurface.getSelection()).toEqual(new Set(['plant-1']))
    expect(runtime.querySurface.getSettledPlacedPlants()).toHaveLength(2)
    expect(runtime.commandSurface.sceneEdits.canPaste()).toBe(true)
    runtime.commandSurface.sceneEdits.paste()
    const pastedScene = runtime.querySurface.getSceneSnapshot()
    expect(pastedScene.plants).toHaveLength(3)
    expect(
      pastedScene.plants.find((plant) => !['plant-1', 'plant-2'].includes(plant.id))?.canonicalName,
    ).toBe('Malus domestica')
    runtime.destroy()
  })

  it('captures Saved Object Stamps only while the Scene is settled', () => {
    const saveCurrentSelection = vi.fn()
    const localizedCommonNames = new Map<string, string | null>([
      ['Malus domestica', 'Orchard Apple'],
    ])
    const runtime = new SceneCanvasRuntime({
      appAdapter: {
        ...createAppCanvasRuntimeAppAdapter(),
        settings: createTestSettingsAdapter(),
        savedObjectStamps: { saveCurrentSelection },
      },
      plantLabels: {
        getLocaleSnapshot: () => localizedCommonNames,
        ensureEntries: async () => false,
      },
    })
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    const sceneEdits = (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
    runtime.commandSurface.sceneEdits.selectAll()

    runtime.commandSurface.sceneEdits.saveSelectionAsObjectStamp()
    expect(saveCurrentSelection).toHaveBeenCalledTimes(1)
    const firstCapture = saveCurrentSelection.mock.calls[0]![0]
    expect(firstCapture.scene.plants[0]?.id).toBe('plant-1')
    expect(firstCapture.selection.editableTargets).toEqual([{ kind: 'plant', id: 'plant-1' }])
    expect(firstCapture.localizedCommonNames).toEqual(new Map([
      ['Malus domestica', 'Orchard Apple'],
    ]))
    expect(firstCapture.localizedCommonNames).not.toBe(localizedCommonNames)

    const active = sceneEdits.begin('interaction-drag')
    runtime.commandSurface.sceneEdits.saveSelectionAsObjectStamp()
    expect(saveCurrentSelection).toHaveBeenCalledTimes(1)

    active.abort()
    runtime.commandSurface.sceneEdits.saveSelectionAsObjectStamp()
    expect(saveCurrentSelection).toHaveBeenCalledTimes(2)
    runtime.destroy()
  })

  it('groups, duplicates, and deletes grouped scene entities', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1', 'plant-2'))

    runtime.commandSurface.sceneEdits.selectAll()
    runtime.commandSurface.sceneEdits.groupSelected()

    const grouped = runtime.querySurface.getSceneSnapshot()
    expect(grouped.groups).toHaveLength(1)
    const groupId = grouped.groups[0]!.id
    expect(selectedObjectIds.value).toEqual(new Set([groupId]))

    runtime.commandSurface.sceneEdits.duplicateSelected()

    const duplicated = runtime.querySurface.getSceneSnapshot()
    expect(duplicated.groups).toHaveLength(2)
    expect(duplicated.plants).toHaveLength(4)
    const duplicateGroupId = [...selectedObjectIds.value][0]!
    expect(duplicateGroupId).not.toBe(groupId)

    runtime.commandSurface.sceneEdits.deleteSelected()

    const afterDelete = runtime.querySurface.getSceneSnapshot()
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
    runtime.documentSurface.loadDocument(file)

    runtime.commandSurface.sceneEdits.selectAll()

    expect(selectedObjectIds.value).toEqual(new Set(['group-1']))
  })

  it('applies selected plant colors through grouped selection', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithGroupedPair())
    runtime.commandSurface.sceneEdits.selectAll()

    const changed = runtime.commandSurface.plantPresentation.setSelectedPlantColor('#ff5500')

    expect(changed).toBe(2)
    expect(runtime.querySurface.getSelectedPlantColorContext()).toMatchObject({
      plantIds: ['plant-1', 'plant-2'],
      sharedCurrentColor: '#FF5500',
      singleSpeciesCanonicalName: 'Malus domestica',
    })
  })

  it('applies selected plant symbols through grouped selection', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithGroupedPair())
    runtime.commandSurface.sceneEdits.selectAll()

    const changed = runtime.commandSurface.plantPresentation.setSelectedPlantSymbol('triangle')

    expect(changed).toBe(2)
    expect(runtime.querySurface.getSelectedPlantSymbolContext()).toMatchObject({
      plantIds: ['plant-1', 'plant-2'],
      sharedCurrentSymbol: 'triangle',
      sharedEffectiveSymbol: 'triangle',
      singleSpeciesCanonicalName: 'Malus domestica',
    })
  })

  it('sets species plant symbols through undoable scene history', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithGroupedPair())

    const changed = runtime.commandSurface.plantPresentation.setPlantSymbolForSpecies('Malus domestica', 'tree')

    expect(changed).toBe(2)
    expect(runtime.querySurface.getSceneSnapshot().plantSpeciesSymbols).toEqual({
      'Malus domestica': 'tree',
    })
    expect(runtime.querySurface.getSceneSnapshot().plants.map((plant) => plant.symbol)).toEqual(['tree', 'tree'])

    runtime.commandSurface.history.undo()
    expect(runtime.querySurface.getSceneSnapshot().plantSpeciesSymbols).toEqual({})
    expect(runtime.querySurface.getSceneSnapshot().plants.map((plant) => plant.symbol ?? null)).toEqual([null, null])

    runtime.commandSurface.history.redo()
    expect(runtime.querySurface.getSceneSnapshot().plantSpeciesSymbols).toEqual({
      'Malus domestica': 'tree',
    })
  })

  it('excludes a locked Plant selected for unlock from plant color edits', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    const file = fileWithOnlyPlants('plant-1')
    file.plants = file.plants.map((plant) => ({ ...plant, locked: true }))
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    clickAt(events, { x: 10, y: 10 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(runtime.querySurface.getDesignObjectSelection().lockedTargets).toEqual([
      { kind: 'plant', id: 'plant-1' },
    ])
    expect(runtime.querySurface.getSelectedPlantColorContext().plantIds).toEqual([])

    const changed = runtime.commandSurface.plantPresentation.setSelectedPlantColor('#228833')

    expect(changed).toBe(0)
    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.color).toBeNull()
    events.dispose()
    runtime.destroy()
  })

  it('excludes a locked Plant selected for unlock from plant symbol edits', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    const file = fileWithOnlyPlants('plant-1')
    file.plants = file.plants.map((plant) => ({ ...plant, locked: true }))
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    clickAt(events, { x: 10, y: 10 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(runtime.querySurface.getSelectedPlantSymbolContext().plantIds).toEqual([])

    const changed = runtime.commandSurface.plantPresentation.setSelectedPlantSymbol('triangle')

    expect(changed).toBe(0)
    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.symbol ?? null).toBeNull()
    events.dispose()
    runtime.destroy()
  })

  it('applies selected plant color only to editable Plants in a mixed locked selection', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    const file = makeFile()
    file.plants = file.plants.map((plant) => (
      plant.id === 'plant-2' ? { ...plant, locked: true } : plant
    ))
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    clickAt(events, { x: 10, y: 10 })
    events.pointerDown({ x: 20, y: 20 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 20, y: 20 }, { button: 0, shiftKey: true })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1', 'plant-2']))
    expect(runtime.querySurface.getSelectedPlantColorContext().plantIds).toEqual(['plant-1'])

    const changed = runtime.commandSurface.plantPresentation.setSelectedPlantColor('#228833')
    const plants = runtime.querySurface.getSceneSnapshot().plants

    expect(changed).toBe(1)
    expect(plants.find((plant) => plant.id === 'plant-1')?.color).toBe('#228833')
    expect(plants.find((plant) => plant.id === 'plant-2')?.color).toBeNull()
    events.dispose()
    runtime.destroy()
  })

  it('toggles snap-to-grid through shared canvas state', () => {
    const runtime = new SceneCanvasRuntime({
      appAdapter: createAppCanvasRuntimeAppAdapter(),
    })

    runtime.commandSurface.chrome.toggleSnapToGrid()
    expect(snapToGridEnabled.value).toBe(true)

    runtime.commandSurface.chrome.toggleSnapToGrid()
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

    runtime.commandSurface.chrome.toggleGrid()
    runtime.commandSurface.chrome.toggleSnapToGrid()
    runtime.commandSurface.chrome.toggleRulers()

    expect(toggleGridVisible).toHaveBeenCalledTimes(1)
    expect(toggleSnapToGrid).toHaveBeenCalledTimes(1)
    expect(toggleRulersVisible).toHaveBeenCalledTimes(1)
  })

  it('publishes viewport-only camera changes through the canonical snapshot', async () => {
    const runtime = new SceneCanvasRuntime()
    await initRuntimeWithStubbedRenderer(runtime)
    expect(runtime.querySurface.viewport).toBe((runtime as any)._camera.snapshot)

    const before = runtime.querySurface.viewport.value.revision
    runtime.commandSurface.viewport.zoomIn()

    expect(runtime.querySurface.viewport.value.revision).toBe(before + 1)
    runtime.destroy()
  })

  it('does not publish a viewport change when document hydration leaves the camera unchanged', async () => {
    const runtime = new SceneCanvasRuntime()
    await initRuntimeWithStubbedRenderer(runtime)
    const before = runtime.querySurface.viewport.value.revision

    runtime.documentSurface.loadDocument(makeFile())

    expect(runtime.querySurface.viewport.value.revision).toBe(before)
    runtime.destroy()
  })

  it('publishes current cache changes while skipping stale persisted presentation backfills', async () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(makeFile())
    const invalidate = vi.spyOn(runtime as any, '_invalidate')

    let resolveRefresh!: (value: ScenePresentationRefreshResult) => void
    const pendingRefresh = new Promise<ScenePresentationRefreshResult>((resolve) => {
      resolveRefresh = resolve
    })
    ;(runtime as any)._presentation.refreshSpeciesCacheEntries = vi.fn(() => pendingRefresh)

    const pending = runtime.commandSurface.plantPresentation.ensureSpeciesCacheEntries(['Malus domestica'], 'en')
    runtime.commandSurface.plantPresentation.setPlantColorForSpecies('Malus domestica', '#335577')
    const invalidationsBeforeRefresh = invalidate.mock.calls.length
    resolveRefresh({
      changed: true,
      plantNamesRevision: 0,
      backfills: [{
        plantId: 'plant-1',
        canonicalName: 'Malus domestica',
        stratum: 'canopy',
        canopySpreadM: 4,
        scale: 4,
      }],
      failure: null,
    })

    await expect(pending).resolves.toBe(true)
    expect(invalidate.mock.calls.slice(invalidationsBeforeRefresh)).toEqual([['scene']])
    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.stratum).toBeNull()
    invalidate.mockRestore()
    runtime.destroy()
  })

  it('derives selected plant context from scene session, not the mirror signal', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))

    runtime.commandSurface.sceneEdits.selectAll()
    selectedObjectIds.value = new Set(['plant-2'])

    expect(runtime.querySurface.getSelectedPlantColorContext().plantIds).toEqual(['plant-1'])
  })

  it('keeps runtime-backed selection authoritative over the mirror signal', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))

    runtime.commandSurface.sceneEdits.selectAll()
    selectedObjectIds.value = new Set(['zone-1'])

    expect(runtime.querySurface.getSelection()).toEqual(new Set(['plant-1']))

    runtime.documentSurface.replaceDocument(
      fileWithOnlyPlants('plant-2'),
      createCanvasDocumentReplacementToken(),
      () => {},
    )
    runtime.commandSurface.sceneEdits.selectAll()
    expect(runtime.querySurface.getSelection()).toEqual(new Set(['plant-2']))
    expect(selectedObjectIds.value).toEqual(new Set(['plant-2']))

    runtime.documentSurface.replaceDocument(
      fileWithOnlyPlants('plant-2'),
      createCanvasDocumentReplacementToken(),
      () => {},
    )
    expect(runtime.querySurface.getSelection().size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
  })

  it('keeps document replacement behind settled Scene admission', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    const sceneEdits = (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
    const active = sceneEdits.begin('interaction-drag')
    active.mutate((draft) => {
      draft.plants[0]!.position = { x: 99, y: 99 }
    })
    const replacementToken = createCanvasDocumentReplacementToken()

    let rejection: unknown
    try {
      runtime.documentSurface.replaceDocument(
        fileWithOnlyPlants('plant-2'),
        replacementToken,
        () => {},
      )
    } catch (error) {
      rejection = error
    }
    expect(rejection).toBeInstanceOf(CanvasDocumentReplacementNotAdmittedError)
    expect(rejection).toMatchObject({ reason: expect.any(SceneEditBusyError) })
    expect(runtime.querySurface.getSceneSnapshot().plants[0]).toMatchObject({
      id: 'plant-1',
      position: { x: 99, y: 99 },
    })

    active.abort()
    runtime.documentSurface.replaceDocument(
      fileWithOnlyPlants('plant-2'),
      replacementToken,
      () => {},
    )
    expect(runtime.querySurface.getSceneSnapshot().plants.map((plant) => plant.id))
      .toEqual(['plant-2'])
    runtime.destroy()
  })

  it('keeps the old Scene authoritative when pre-hydration target cleanup fails', () => {
    let failPanelTargetCleanup = false
    const targetPresentation: SceneRuntimePanelTargetAdapter = {
      readPanelOriginTargets: () => [],
      setCanvasHoverTargets: () => {},
      clearPanelOriginTargets: () => {
        if (failPanelTargetCleanup) throw new Error('panel target cleanup failed')
      },
      subscribePanelOriginTargetChanges: () => () => {},
    }
    const runtime = new SceneCanvasRuntime({ targetPresentation })
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    runtime.commandSurface.sceneEdits.selectAll()
    expect(runtime.querySurface.getSelection()).toEqual(new Set(['plant-1']))
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    failPanelTargetCleanup = true
    const replacementToken = createCanvasDocumentReplacementToken()

    expect(() => runtime.documentSurface.replaceDocument(
      fileWithOnlyPlants('plant-2'),
      replacementToken,
      () => {},
    ))
      .toThrow('panel target cleanup failed')
    expect(runtime.querySurface.getSceneSnapshot().plants.map((plant) => plant.id))
      .toEqual(['plant-1'])
    expect(runtime.querySurface.getSelection()).toEqual(new Set(['plant-1']))
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))

    failPanelTargetCleanup = false
    runtime.documentSurface.replaceDocument(
      fileWithOnlyPlants('plant-2'),
      replacementToken,
      () => {},
    )
    expect(runtime.querySurface.getSceneSnapshot().plants.map((plant) => plant.id))
      .toEqual(['plant-2'])
    expect(runtime.querySurface.getSelection()).toEqual(new Set())
    expect(selectedObjectIds.value).toEqual(new Set())
    runtime.destroy()
  })

  it('rolls back renderer ownership when interaction Session construction fails', async () => {
    const runtime = new SceneCanvasRuntime()
    const container = createRuntimeContainer()
    const renderer = createRendererStub()
    const disposeRenderer = vi.fn(async () => {})
    ;(runtime as any)._construction.replaceRendererHost({
      initialize: async () => renderer,
      run: async (operation: (instance: typeof renderer) => unknown) => operation(renderer),
      dispose: disposeRenderer,
    })
    const appendChild = vi.spyOn(container, 'appendChild').mockImplementation(() => {
      throw new Error('interaction construction failed')
    })

    try {
      await expect(runtime.init(container)).rejects.toThrow('interaction construction failed')
    } finally {
      appendChild.mockRestore()
    }

    expect(disposeRenderer).toHaveBeenCalledTimes(1)
    expect((runtime as any)._rendering.container).toBeNull()
    runtime.destroy()
  })

  it('rolls back Session listeners and renderer ownership when the initial render fails', async () => {
    const runtime = new SceneCanvasRuntime()
    const container = createRuntimeContainer()
    const events = createSceneInteractionEventHarness(container, { trackListeners: true })
    const renderer = createRendererStub()
    renderer.renderScene.mockImplementation(() => {
      throw new Error('initial render failed')
    })
    const disposeRenderer = vi.fn(async () => {})
    ;(runtime as any)._construction.replaceRendererHost({
      initialize: async () => renderer,
      run: async (operation: (instance: typeof renderer) => unknown) => operation(renderer),
      dispose: disposeRenderer,
    })

    await expect(runtime.init(container)).rejects.toThrow('initial render failed')

    expect(disposeRenderer).toHaveBeenCalledTimes(1)
    expect(events.listenerLog?.containerRemoves('pointerdown')).toHaveLength(1)
    expect(events.listenerLog?.windowRemoves('pointermove')).toHaveLength(1)
    expect(container.querySelector('[data-hover-tooltip]')).toBeNull()
    expect((runtime as any)._rendering.container).toBeNull()
    events.dispose()
    runtime.destroy()
  })

  it('does not publish deferred presentation backfills after runtime teardown', async () => {
    const cache = new Map<string, Record<string, unknown>>()
    let resolveRefresh!: () => void
    const refresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })
    const ensureEntries = vi.fn(async (canonicalNames: string[]) => {
      await refresh
      for (const canonicalName of canonicalNames) {
        cache.set(canonicalName, { stratum: 'canopy', width_max_m: 4 })
      }
      return true
    })
    const runtime = new SceneCanvasRuntime({
      speciesCache: {
        getCache: () => cache,
        ensureEntries,
        getSuggestedPlantColor: () => null,
      },
    })
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    const container = createRuntimeContainer()
    const renderer = createRendererStub()
    ;(runtime as any)._construction.replaceRendererHost({
      initialize: async () => renderer,
      run: async (operation: (instance: typeof renderer) => unknown) => operation(renderer),
      dispose: async () => {},
    })
    const initialize = runtime.init(container)
    await vi.waitFor(() => expect(ensureEntries).toHaveBeenCalledOnce())
    const sceneRevision = runtime.querySurface.revision.scene.value
    const invalidate = vi.spyOn((runtime as any)._rendering, 'invalidate')
    invalidate.mockClear()

    runtime.destroy()
    resolveRefresh()
    await initialize

    expect(runtime.querySurface.getSceneSnapshot().plants[0]).toMatchObject({
      stratum: null,
      canopySpreadM: null,
      scale: null,
    })
    expect(runtime.querySurface.revision.scene.value).toBe(sceneRevision)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does not publish a deferred presentation command after runtime teardown', async () => {
    const cache = new Map<string, Record<string, unknown>>()
    let resolveRefresh!: () => void
    const refresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })
    const ensureEntries = vi.fn(async (canonicalNames: string[]) => {
      await refresh
      for (const canonicalName of canonicalNames) {
        cache.set(canonicalName, { stratum: 'canopy', width_max_m: 4 })
      }
      return true
    })
    const runtime = new SceneCanvasRuntime({
      speciesCache: {
        getCache: () => cache,
        ensureEntries,
        getSuggestedPlantColor: () => null,
      },
    })
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    const publication = runtime.commandSurface.plantPresentation.ensureSpeciesCacheEntries(
      ['Malus domestica'],
      'en',
    )
    await vi.waitFor(() => expect(ensureEntries).toHaveBeenCalledOnce())
    const sceneRevision = runtime.querySurface.revision.scene.value
    const invalidate = vi.spyOn((runtime as any)._rendering, 'invalidate')
    invalidate.mockClear()

    runtime.destroy()
    resolveRefresh()

    await expect(publication).resolves.toBe(false)
    expect(runtime.querySurface.getSceneSnapshot().plants[0]).toMatchObject({
      stratum: null,
      canopySpreadM: null,
      scale: null,
    })
    expect(runtime.querySurface.revision.scene.value).toBe(sceneRevision)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('publishes prepared plant labels before surfacing a later species-cache failure', async () => {
    const labelsByLocale = new Map<string, Map<string, string | null>>()
    const speciesFailure = new Error('species refresh failed')
    let activeLocale = 'en'
    let failSpeciesRefresh = false
    const appAdapterProbe = createCleanStateAdapterProbe()
    const runtime = new SceneCanvasRuntime({
      appAdapter: {
        ...appAdapterProbe.adapter,
        settings: createTestSettingsAdapter({
          readLocale: () => activeLocale,
        }),
      },
      plantLabels: {
        getLocaleSnapshot: (locale) => labelsByLocale.get(locale) ?? new Map(),
        ensureEntries: async (_canonicalNames, locale) => {
          if (labelsByLocale.has(locale)) return false
          labelsByLocale.set(locale, new Map([
            ['Malus domestica', locale === 'fr' ? 'Pommier' : 'Apple'],
          ]))
          return true
        },
      },
      speciesCache: {
        getCache: () => new Map(),
        ensureEntries: async () => {
          if (failSpeciesRefresh) throw speciesFailure
          return false
        },
        getSuggestedPlantColor: () => null,
      },
    })
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)
    const plantNamesRevision = runtime.querySurface.revision.plantNames.value
    const initialRenderCount = renderer.renderScene.mock.calls.length
    activeLocale = 'fr'
    failSpeciesRefresh = true

    await expect(runtime.commandSurface.plantPresentation.ensureSpeciesCacheEntries(
      ['Malus domestica'],
      'fr',
    )).rejects.toBe(speciesFailure)
    await vi.waitFor(() => {
      expect(renderer.renderScene.mock.calls.length).toBeGreaterThan(initialRenderCount)
    })

    const rendered = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
    expect(rendered?.localizedCommonNames.get('Malus domestica')).toBe('Pommier')
    expect(runtime.querySurface.getLocalizedCommonNames().get('Malus domestica')).toBe('Pommier')
    expect(runtime.querySurface.revision.plantNames.value).toBe(plantNamesRevision + 1)
    runtime.destroy()
  })

  it('invalidates and reports a cached refresh that publishes pending plant labels', async () => {
    const labels = new Map<string, string | null>()
    let labelsLoaded = false
    const runtime = new SceneCanvasRuntime({
      plantLabels: {
        getLocaleSnapshot: () => labels,
        ensureEntries: async () => {
          if (labelsLoaded) return false
          labelsLoaded = true
          labels.set('Malus domestica', 'Apple')
          return true
        },
      },
      speciesCache: {
        getCache: () => new Map(),
        ensureEntries: async () => false,
        getSuggestedPlantColor: () => null,
      },
    })
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    const plantNamesRevision = runtime.querySurface.revision.plantNames.value
    const stagedRefresh = await (runtime as any)._presentation.refreshSpeciesCacheEntries(
      ['Malus domestica'],
      'en',
    )
    expect(stagedRefresh.changed).toBe(true)
    expect(runtime.querySurface.revision.plantNames.value).toBe(plantNamesRevision)
    const invalidate = vi.spyOn((runtime as any)._rendering, 'invalidate')

    await expect(runtime.commandSurface.plantPresentation.ensureSpeciesCacheEntries(
      ['Malus domestica'],
      'en',
    )).resolves.toBe(true)

    expect(runtime.querySurface.revision.plantNames.value).toBe(plantNamesRevision + 1)
    expect(invalidate).toHaveBeenCalledWith('scene')
    runtime.destroy()
  })

  it('does not publish prepared plant labels when a later species failure settles after teardown', async () => {
    const labels = new Map<string, string | null>()
    const speciesFailure = new Error('deferred species refresh failed')
    let rejectSpecies!: (error: Error) => void
    const speciesRefresh = new Promise<boolean>((_resolve, reject) => {
      rejectSpecies = reject
    })
    const ensureSpeciesEntries = vi.fn(() => speciesRefresh)
    const runtime = new SceneCanvasRuntime({
      plantLabels: {
        getLocaleSnapshot: () => labels,
        ensureEntries: async () => {
          labels.set('Malus domestica', 'Apple')
          return true
        },
      },
      speciesCache: {
        getCache: () => new Map(),
        ensureEntries: ensureSpeciesEntries,
        getSuggestedPlantColor: () => null,
      },
    })
    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    const plantNamesRevision = runtime.querySurface.revision.plantNames.value
    const invalidate = vi.spyOn((runtime as any)._rendering, 'invalidate')
    const publication = runtime.commandSurface.plantPresentation.ensureSpeciesCacheEntries(
      ['Malus domestica'],
      'en',
    )
    const rejection = expect(publication).rejects.toBe(speciesFailure)
    await vi.waitFor(() => expect(ensureSpeciesEntries).toHaveBeenCalledOnce())

    runtime.destroy()
    rejectSpecies(speciesFailure)

    await rejection
    expect(runtime.querySurface.getLocalizedCommonNames().get('Malus domestica')).toBe('Apple')
    expect(runtime.querySurface.revision.plantNames.value).toBe(plantNamesRevision)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('describes editable top-level Design Object selection with visual bounds', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithOnlyZone())

    runtime.commandSurface.sceneEdits.selectAll()

    expect(runtime.querySurface.getDesignObjectSelection()).toEqual({
      editableTargets: [{ kind: 'zone', id: 'zone-1' }],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
      sameSpeciesReferenceCanonicalName: null,
      plantNamePinning: {
        plantIds: [],
        allPinned: false,
      },
    })
  })

  it('describes selected Design Objects blocked by locked Layers', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(fileWithOnlyZone())
    runtime.commandSurface.sceneEdits.selectAll()

    runtime.commandSurface.layers.setSceneLayerLocked('zones', true)

    expect(runtime.querySurface.getDesignObjectSelection()).toEqual({
      editableTargets: [],
      lockedTargets: [],
      blockedTargets: [{
        target: { kind: 'zone', id: 'zone-1' },
        reason: 'locked-layer',
        layerName: 'zones',
      }],
      bounds: null,
      sameSpeciesReferenceCanonicalName: null,
      plantNamePinning: {
        plantIds: [],
        allPinned: false,
      },
    })
  })

  it('refreshes Zone Measurements when runtime selection changes', async () => {
    const runtime = new SceneCanvasRuntime()
    const file = makeFile()
    file.zones = [{
      name: 'zone-1',
      zone_type: 'rect',
      rotation: 0,
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
    runtime.documentSurface.loadDocument(fileWithOnlyZone(file.zones[0]!))
    const { container } = await initRuntimeWithStubbedRenderer(runtime)

    runtime.commandSurface.sceneEdits.selectAll()

    expect(zoneMeasurementTexts(container)).toEqual([
      '100 m',
      '80 m',
      '100 m',
      '80 m',
      '8000 m²',
    ])

    runtime.documentSurface.replaceDocument(
      fileWithOnlyZone(file.zones[0]!),
      createCanvasDocumentReplacementToken(),
      () => {},
    )

    expect(zoneMeasurementTexts(container)).toEqual([])
    runtime.destroy()
  })

  it('resolves hovered panel targets for renderer highlights without mutating selection', async () => {
    const runtime = createRuntimeWithAppPanelTargets()
    runtime.documentSurface.loadDocument(makeFile())
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
    expect(runtime.querySurface.getSelection().size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    runtime.destroy()
  })

  it('resolves selected panel targets for renderer highlights without mutating canvas selection or dirty state', async () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = createRuntimeWithAppPanelTargets(cleanState.adapter)
    runtime.documentSurface.loadDocument(makeFile())
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
    expect(runtime.querySurface.getSelection().size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(cleanState.setCanvasClean).not.toHaveBeenCalledWith(false)
    runtime.destroy()
  })

  it('keeps typed panel target highlights separate when plant IDs and zone names collide', async () => {
    const runtime = createRuntimeWithAppPanelTargets()
    runtime.documentSurface.loadDocument({
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
    runtime.documentSurface.loadDocument(makeFile())
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    renderer.renderScene.mockClear()
    selectedPanelTargets.value = [speciesTarget('Malus domestica')]
    hoveredPanelTargets.value = [{ kind: 'zone', zone_name: 'zone-1' }]

    await vi.waitFor(() => {
      const snapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
      expect(snapshot?.highlightedPlantIds).toEqual(new Set(['plant-1', 'plant-2']))
      expect(snapshot?.highlightedZoneIds).toEqual(new Set(['zone-1']))
    })

    expect(runtime.querySurface.getSelection().size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    runtime.destroy()
  })

  it('uses the injected panel target adapter for highlights and canvas-origin hover', async () => {
    const panelTargetProbe = createPanelTargetAdapterProbe()
    const runtime = new SceneCanvasRuntime({ targetPresentation: panelTargetProbe.adapter })
    runtime.documentSurface.loadDocument(makeFile())
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
    runtime.documentSurface.replaceDocument(
      makeFile(),
      createCanvasDocumentReplacementToken(),
      () => {},
    )
    expect(panelTargetProbe.panelOriginTargets).toEqual([])
    runtime.destroy()
  })

  it('reports canvas clean-state transitions through the injected app adapter', () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = new SceneCanvasRuntime({ appAdapter: cleanState.adapter })
    const file = fileWithOnlyPlants('plant-1')

    runtime.documentSurface.loadDocument(file)
    runtime.documentSurface.captureForPersistence({ name: file.name }, file).acknowledgeSaved()
    cleanState.setCanvasClean.mockClear()

    runtime.commandSurface.sceneEdits.selectAll()
    runtime.commandSurface.sceneEdits.lockSelected()
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)

    runtime.commandSurface.history.undo()
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(true)

    runtime.commandSurface.history.redo()
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)

    runtime.documentSurface.captureForPersistence({ name: file.name }, file).acknowledgeSaved()
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(true)
  })

  it('stales existing persistence receipts and rejects new capture after destroy', () => {
    const runtime = new SceneCanvasRuntime()
    const file = fileWithOnlyPlants('plant-1')
    runtime.documentSurface.loadDocument(file)
    const capture = runtime.documentSurface.captureForPersistence({ name: file.name }, file)

    runtime.destroy()

    expect(capture.acknowledgeSaved()).toBe('stale')
    expect(() => runtime.documentSurface.captureForPersistence({ name: file.name }, file))
      .toThrow('runtime-disposed')
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

    runtime.documentSurface.loadDocument(fileWithOnlyPlants('plant-1'))
    runtime.commandSurface.sceneEdits.selectAll()
    runtime.commandSurface.plantPresentation.setSelectedPlantColor('#228833')

    const serialized = runtime.documentSurface.captureForPersistence({ name: 'Adapter save' }, file).content

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

    runtime.documentSurface.loadDocument({
      ...file,
      plants: [file.plants[0]!],
      zones: [],
      groups: [],
    })
    runtime.commandSurface.sceneEdits.selectAll()
    runtime.commandSurface.plantPresentation.setSelectedPlantColor('#228833')

    const serialized = runtime.documentSurface.captureForPersistence({ name: 'Detached save' }, file).content

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
    runtime.documentSurface.loadDocument(makeFile())
    cleanState.setCanvasClean.mockClear()
    await initRuntimeWithStubbedRenderer(runtime)

    ;(runtime as any)._interaction._deps.setHoveredEntityId('plant-1')

    expect(hoveredCanvasTargets.value).toEqual([speciesTarget('Malus domestica')])
    expect(runtime.querySurface.getSelection().size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(cleanState.setCanvasClean).not.toHaveBeenCalledWith(false)

    ;(runtime as any)._interaction._deps.setHoveredEntityId(null)

    expect(hoveredCanvasTargets.value).toEqual([])
    expect(runtime.querySurface.getSelection().size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(cleanState.setCanvasClean).not.toHaveBeenCalledWith(false)
    runtime.destroy()
  })

  it('clears canvas-origin hover during destroy without rendering into a disposing renderer', async () => {
    const runtime = createRuntimeWithAppPanelTargets()
    runtime.documentSurface.loadDocument(makeFile())
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
    setInteractionViewport(runtime, viewport)

    renderer.renderScene.mockClear()
    runtime.commandSurface.viewport.zoomIn()
    await Promise.resolve()
    await Promise.resolve()

    expect(renderer.setViewport).toHaveBeenCalled()
    expect(renderer.renderScene).not.toHaveBeenCalled()
    runtime.destroy()
  })

  it('publishes zoom and effective resize updates exactly once', async () => {
    const runtime = new SceneCanvasRuntime()
    await initRuntimeWithStubbedRenderer(runtime)
    const initialRevision = runtime.querySurface.viewport.value.revision

    runtime.commandSurface.viewport.zoomIn()
    expect(runtime.querySurface.viewport.value.revision).toBe(initialRevision + 1)

    runtime.documentSurface.resize(600, 450)
    expect(runtime.querySurface.viewport.value.revision).toBe(initialRevision + 2)

    runtime.documentSurface.resize(600, 450)
    expect(runtime.querySurface.viewport.value.revision).toBe(initialRevision + 2)
    runtime.destroy()
  })

  it('resets transient runtime state before replacing the document', async () => {
    const runtime = createRuntimeWithAppPanelTargets()
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)

    runtime.documentSurface.loadDocument(makeFile())
    runtime.commandSurface.tools.setTool('plant-stamp')
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
    runtime.commandSurface.sceneEdits.selectAll()

    renderer.renderScene.mockClear()
    runtime.documentSurface.replaceDocument(
      makeFile(),
      createCanvasDocumentReplacementToken(),
      () => {},
    )
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
    const events = createSceneInteractionEventHarness(container)
    const file = makeFile()
    file.plants = file.plants.map((plant) => ({ ...plant, symbol: 'triangle', pinned_name: true }))
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)

    clickAt(events, { x: 20, y: 20 })
    runtime.commandSurface.sceneEdits.copy()
    runtime.commandSurface.tools.setTool('object-stamp')

    events.pointerDown({ x: 10, y: 10 })
    events.pointerDown({ x: 30, y: 30 })

    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(3)
    const stampedId = runtime.querySurface.getSceneSnapshot().plants[2]!.id
    expect(runtime.querySurface.getSceneSnapshot().plants[2]!.pinnedName).toBe(false)
    expect(selectedObjectIds.value).toEqual(new Set([stampedId]))

    runtime.commandSurface.history.undo()
    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(2)

    runtime.commandSurface.sceneEdits.paste()
    const pasted = runtime.querySurface.getSceneSnapshot().plants[2]!
    expect(pasted.canonicalName).toBe('Malus domestica')
    expect(pasted.symbol).toBe('triangle')
    expect(pasted.pinnedName).toBe(false)
    expect(pasted.position).toEqual({ x: 21, y: 20 })
    events.dispose()
    runtime.destroy()
  })

  it('records Object Stamp group placement as one undoable edit with cloned members', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    const file = makeFile()
    file.zones = []
    file.groups = [{
      id: 'group-1',
      name: 'Pair',
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'plant', id: 'plant-2' },
      ],
    }]
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('object-stamp')

    events.pointerDown({ x: 10, y: 10 })
    events.pointerDown({ x: 40, y: 40 })

    expect(runtime.querySurface.getSceneSnapshot().groups).toHaveLength(2)
    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(4)
    const stampedGroup = runtime.querySurface.getSceneSnapshot().groups[1]!
    expect(selectedObjectIds.value).toEqual(new Set([stampedGroup.id]))
    expect(stampedGroup.members).toHaveLength(2)
    expect(stampedGroup.members.map((member) => member.id)).not.toContain('plant-1')
    expect(stampedGroup.members.map((member) => member.id)).not.toContain('plant-2')

    runtime.commandSurface.history.undo()
    expect(runtime.querySurface.getSceneSnapshot().groups).toHaveLength(1)
    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(2)
    events.dispose()
    runtime.destroy()
  })

  it('records Saved Object Stamp placement as one undoable scene edit', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    const file = makeFile()
    file.plants = []
    file.zones = []
    file.annotations = []
    file.groups = []
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)
    selectSavedObjectStampSource({
      version: 1,
      anchor: { x: 10, y: 10 },
      plants: [{
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        symbol: null,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        scale: 2,
      }],
      zones: [{
        id: 'zone-1',
        name: 'Bed',
        zoneType: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        rotationDeg: 0,
        fillColor: null,
      }],
      annotations: [],
      groups: [],
    })
    runtime.commandSurface.tools.setTool('saved-object-stamp')

    events.pointerDown({ x: 40, y: 40 })

    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(1)
    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.pinnedName).toBe(false)
    expect(runtime.querySurface.getSceneSnapshot().zones).toHaveLength(1)
    expect(runtime.commandSurface.history.canUndo.value).toBe(true)

    runtime.commandSurface.history.undo()

    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(0)
    expect(runtime.querySurface.getSceneSnapshot().zones).toHaveLength(0)
    expect(runtime.commandSurface.history.canRedo.value).toBe(true)
    events.dispose()
    runtime.destroy()
  })

  it('records Plant Spacing commit as one undoable scene edit', async () => {
    const cleanState = createCleanStateAdapterProbe()
    cleanState.adapter.settings.commitPlantSpacingIntervalMeters(5)
    const runtime = new SceneCanvasRuntime({ appAdapter: cleanState.adapter })
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, pinned_name: true } : plant,
    )
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('plant-spacing')

    events.pointerDown({ x: 10, y: 10 })
    events.pointerMove({ x: 20, y: 10 })
    events.pointerDown({ x: 20, y: 10 })

    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(4)
    expect(runtime.querySurface.getSceneSnapshot().plants.slice(2).map((plant) => plant.pinnedName)).toEqual([false, false])
    expect(runtime.commandSurface.history.canUndo.value).toBe(true)

    runtime.commandSurface.history.undo()
    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(2)
    expect(runtime.commandSurface.history.canRedo.value).toBe(true)

    runtime.commandSurface.history.redo()
    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(4)
    events.dispose()
    runtime.destroy()
  })

  it('records Measurement Guide creation as one undoable scene edit', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    const file = makeFile()
    file.layers = [
      ...file.layers,
      { name: 'measurement-guides', visible: true, locked: false, opacity: 1 },
    ]
    file.measurement_guides = []
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('measurement-guide')

    events.pointerDown({ x: 10, y: 10 })
    events.pointerMove({ x: 40, y: 10 })

    expect(zoneMeasurementTexts(container)).toEqual(['30 m'])

    events.pointerUp({ x: 40, y: 10 })

    const created = runtime.querySurface.getSceneSnapshot().measurementGuides
    expect(created).toHaveLength(1)
    const createdGuide = created?.[0]!
    expect(createdGuide).toMatchObject({
      kind: 'measurement-guide',
      locked: false,
      start: { x: 10, y: 10 },
      end: { x: 40, y: 10 },
    })
    expect(runtime.commandSurface.history.canUndo.value).toBe(true)

    const serialized = runtime.documentSurface.captureForPersistence({ name: file.name }, file).content
    expect(serialized.measurement_guides).toEqual([
      {
        id: createdGuide.id,
        locked: false,
        start: { x: 10, y: 10 },
        end: { x: 40, y: 10 },
      },
    ])

    runtime.commandSurface.history.undo()
    expect(runtime.querySurface.getSceneSnapshot().measurementGuides).toHaveLength(0)
    expect(runtime.commandSurface.history.canRedo.value).toBe(true)

    runtime.commandSurface.history.redo()
    expect(runtime.querySurface.getSceneSnapshot().measurementGuides).toHaveLength(1)
    events.dispose()
    runtime.destroy()
  })

  it('selects a newly created Measurement Guide instead of keeping a stale object selection', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    const file = makeFile()
    file.layers = [
      ...file.layers,
      { name: 'measurement-guides', visible: true, locked: false, opacity: 1 },
    ]
    file.measurement_guides = []
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    clickAt(events, { x: 10, y: 10 })
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))

    runtime.commandSurface.tools.setTool('measurement-guide')
    events.pointerDown({ x: 100, y: 10 })
    events.pointerMove({ x: 140, y: 10 })
    events.pointerUp({ x: 140, y: 10 })

    const createdGuide = runtime.querySurface.getSceneSnapshot().measurementGuides[0]
    expect(createdGuide).toBeDefined()
    expect(selectedObjectIds.value).toEqual(new Set([createdGuide!.id]))
    expect(runtime.querySurface.getDesignObjectSelection().editableTargets).toEqual([
      { kind: 'measurement-guide', id: createdGuide!.id },
    ])

    runtime.commandSurface.sceneEdits.deleteSelected()

    expect(runtime.querySurface.getSceneSnapshot().measurementGuides).toHaveLength(0)
    expect(runtime.querySurface.getSceneSnapshot().plants).toHaveLength(2)
    events.dispose()
    runtime.destroy()
  })

  it('keeps the current selection when a Measurement Guide drag creates no guide', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    const file = makeFile()
    file.layers = [
      ...file.layers,
      { name: 'measurement-guides', visible: true, locked: false, opacity: 1 },
    ]
    file.measurement_guides = []
    runtime.documentSurface.loadDocument(file)
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    clickAt(events, { x: 10, y: 10 })
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))

    runtime.commandSurface.tools.setTool('measurement-guide')
    events.pointerDown({ x: 100, y: 10 })
    events.pointerUp({ x: 100, y: 10 })

    expect(runtime.querySurface.getSceneSnapshot().measurementGuides).toHaveLength(0)
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(runtime.commandSurface.history.canUndo.value).toBe(false)
    events.dispose()
    runtime.destroy()
  })

  it('selects and moves Measurement Guides as undoable Design Objects', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithMeasurementGuide())
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    clickAt(events, { x: 25, y: 10 })

    expect(selectedObjectIds.value).toEqual(new Set(['measurement-guide-1']))
    expect(runtime.querySurface.getDesignObjectSelection().editableTargets).toEqual([
      { kind: 'measurement-guide', id: 'measurement-guide-1' },
    ])

    events.pointerDown({ x: 25, y: 10 })
    events.pointerMove({ x: 35, y: 20 })
    events.pointerUp({ x: 35, y: 20 })

    expect(runtime.querySurface.getSceneSnapshot().measurementGuides).toEqual([{
      kind: 'measurement-guide',
      id: 'measurement-guide-1',
      locked: false,
      start: { x: 20, y: 20 },
      end: { x: 50, y: 20 },
    }])
    expect(runtime.commandSurface.history.canUndo.value).toBe(true)

    runtime.commandSurface.history.undo()
    expect(runtime.querySurface.getSceneSnapshot().measurementGuides[0]).toMatchObject({
      start: { x: 10, y: 10 },
      end: { x: 40, y: 10 },
    })
    expect(runtime.commandSurface.history.canRedo.value).toBe(true)

    runtime.commandSurface.history.redo()
    expect(runtime.querySurface.getSceneSnapshot().measurementGuides[0]).toMatchObject({
      start: { x: 20, y: 20 },
      end: { x: 50, y: 20 },
    })
    events.dispose()
    runtime.destroy()
  })

  it('duplicates, copy/pastes, and deletes Measurement Guides', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithMeasurementGuide())
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    clickAt(events, { x: 25, y: 10 })
    runtime.commandSurface.sceneEdits.duplicateSelected()

    let guides = runtime.querySurface.getSceneSnapshot().measurementGuides
    expect(guides).toHaveLength(2)
    const duplicate = guides.find((guide) => guide.id !== 'measurement-guide-1')
    expect(duplicate).toMatchObject({
      locked: false,
      start: { x: 11, y: 10 },
      end: { x: 41, y: 10 },
    })
    expect(selectedObjectIds.value).toEqual(new Set([duplicate!.id]))

    runtime.commandSurface.sceneEdits.copy()
    runtime.commandSurface.sceneEdits.paste()

    guides = runtime.querySurface.getSceneSnapshot().measurementGuides
    expect(guides).toHaveLength(3)
    const pastedId = [...selectedObjectIds.value][0]!
    expect(guides.find((guide) => guide.id === pastedId)).toMatchObject({
      locked: false,
      start: { x: 12, y: 10 },
      end: { x: 42, y: 10 },
    })

    runtime.commandSurface.sceneEdits.deleteSelected()

    guides = runtime.querySurface.getSceneSnapshot().measurementGuides
    expect(guides).toHaveLength(2)
    expect(guides.some((guide) => guide.id === pastedId)).toBe(false)
    expect(selectedObjectIds.value.size).toBe(0)
    events.dispose()
    runtime.destroy()
  })

  it('respects direct Measurement Guide locks and layer locks for selection and mutation', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(fileWithMeasurementGuide({ locked: true }))
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('select')

    clickAt(events, { x: 25, y: 10 })

    expect(selectedObjectIds.value).toEqual(new Set(['measurement-guide-1']))
    expect(runtime.querySurface.getDesignObjectSelection().editableTargets).toEqual([])
    expect(runtime.querySurface.getDesignObjectSelection().lockedTargets).toEqual([
      { kind: 'measurement-guide', id: 'measurement-guide-1' },
    ])

    runtime.commandSurface.sceneEdits.duplicateSelected()
    runtime.commandSurface.sceneEdits.deleteSelected()

    expect(runtime.querySurface.getSceneSnapshot().measurementGuides).toHaveLength(1)
    expect(runtime.querySurface.getSceneSnapshot().measurementGuides[0]?.locked).toBe(true)

    runtime.commandSurface.sceneEdits.unlockSelected()
    expect(runtime.querySurface.getSceneSnapshot().measurementGuides[0]?.locked).toBe(false)
    runtime.commandSurface.sceneEdits.duplicateSelected()
    expect(runtime.querySurface.getSceneSnapshot().measurementGuides).toHaveLength(2)
    events.dispose()
    runtime.destroy()
    selectedObjectIds.value = new Set()

    const lockedLayerRuntime = new SceneCanvasRuntime()
    const { container: lockedLayerContainer } = await initRuntimeWithStubbedRenderer(lockedLayerRuntime)
    const lockedLayerEvents = createSceneInteractionEventHarness(lockedLayerContainer)
    const lockedLayerFile = fileWithMeasurementGuide()
    lockedLayerFile.layers = lockedLayerFile.layers.map((layer) =>
      layer.name === 'measurement-guides' ? { ...layer, locked: true } : layer,
    )
    lockedLayerRuntime.documentSurface.loadDocument(lockedLayerFile)
    setInteractionViewport(lockedLayerRuntime)
    lockedLayerRuntime.commandSurface.tools.setTool('select')

    clickAt(lockedLayerEvents, { x: 25, y: 10 })
    lockedLayerRuntime.commandSurface.sceneEdits.selectAll()

    expect(selectedObjectIds.value.size).toBe(0)
    expect(lockedLayerRuntime.querySurface.getDesignObjectSelection().editableTargets).toEqual([])
    lockedLayerEvents.dispose()
    lockedLayerRuntime.destroy()
    selectedObjectIds.value = new Set()

    const hiddenLayerRuntime = new SceneCanvasRuntime()
    const { container: hiddenLayerContainer } = await initRuntimeWithStubbedRenderer(hiddenLayerRuntime)
    const hiddenLayerEvents = createSceneInteractionEventHarness(hiddenLayerContainer)
    const hiddenLayerFile = fileWithMeasurementGuide()
    hiddenLayerFile.layers = hiddenLayerFile.layers.map((layer) =>
      layer.name === 'measurement-guides' ? { ...layer, visible: false } : layer,
    )
    hiddenLayerRuntime.documentSurface.loadDocument(hiddenLayerFile)
    setInteractionViewport(hiddenLayerRuntime)
    hiddenLayerRuntime.commandSurface.tools.setTool('select')

    clickAt(hiddenLayerEvents, { x: 25, y: 10 })
    hiddenLayerRuntime.commandSurface.sceneEdits.selectAll()

    expect(selectedObjectIds.value.size).toBe(0)
    expect(hiddenLayerRuntime.querySurface.getDesignObjectSelection().editableTargets).toEqual([])
    hiddenLayerEvents.dispose()
    hiddenLayerRuntime.destroy()
  })

  it('keeps Measurement Guides out of Object Groups', () => {
    const runtime = new SceneCanvasRuntime()
    const file = fileWithMeasurementGuide()
    file.plants = [makeFile().plants[0]!]
    file.zones = [makeFile().zones[0]!]
    runtime.documentSurface.loadDocument(file)

    runtime.commandSurface.sceneEdits.selectAll()
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1', 'zone-1', 'measurement-guide-1']))

    runtime.commandSurface.sceneEdits.groupSelected()

    const scene = runtime.querySurface.getSceneSnapshot()
    expect(scene.groups).toHaveLength(1)
    expect(scene.groups[0]?.members).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'zone-1' },
    ])
    expect(scene.measurementGuides).toHaveLength(1)
    runtime.destroy()
  })

  it('does not create Measurement Guides when their layer is locked or hidden', async () => {
    const lockedRuntime = new SceneCanvasRuntime()
    const { container: lockedContainer } = await initRuntimeWithStubbedRenderer(lockedRuntime)
    const lockedEvents = createSceneInteractionEventHarness(lockedContainer)
    const lockedFile = makeFile()
    lockedFile.layers = [
      ...lockedFile.layers,
      { name: 'measurement-guides', visible: true, locked: true, opacity: 1 },
    ]
    lockedFile.measurement_guides = []
    lockedRuntime.documentSurface.loadDocument(lockedFile)
    setInteractionViewport(lockedRuntime)
    lockedRuntime.commandSurface.tools.setTool('select')

    clickAt(lockedEvents, { x: 10, y: 10 })
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))

    lockedRuntime.commandSurface.tools.setTool('measurement-guide')

    lockedEvents.pointerDown({ x: 10, y: 10 })
    lockedEvents.pointerMove({ x: 40, y: 10 })
    lockedEvents.pointerUp({ x: 40, y: 10 })

    expect(zoneMeasurementTexts(lockedContainer)).toEqual([])
    expect(lockedRuntime.querySurface.getSceneSnapshot().measurementGuides).toHaveLength(0)
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(lockedRuntime.commandSurface.history.canUndo.value).toBe(false)
    lockedEvents.dispose()
    lockedRuntime.destroy()

    const hiddenRuntime = new SceneCanvasRuntime()
    const { container: hiddenContainer } = await initRuntimeWithStubbedRenderer(hiddenRuntime)
    const hiddenEvents = createSceneInteractionEventHarness(hiddenContainer)
    const hiddenFile = makeFile()
    hiddenFile.layers = [
      ...hiddenFile.layers,
      { name: 'measurement-guides', visible: false, locked: false, opacity: 1 },
    ]
    hiddenFile.measurement_guides = []
    hiddenRuntime.documentSurface.loadDocument(hiddenFile)
    setInteractionViewport(hiddenRuntime)
    hiddenRuntime.commandSurface.tools.setTool('select')

    clickAt(hiddenEvents, { x: 10, y: 10 })
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))

    hiddenRuntime.commandSurface.tools.setTool('measurement-guide')

    hiddenEvents.pointerDown({ x: 10, y: 10 })
    hiddenEvents.pointerMove({ x: 40, y: 10 })
    hiddenEvents.pointerUp({ x: 40, y: 10 })

    expect(zoneMeasurementTexts(hiddenContainer)).toEqual([])
    expect(hiddenRuntime.querySurface.getSceneSnapshot().measurementGuides).toHaveLength(0)
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(hiddenRuntime.commandSurface.history.canUndo.value).toBe(false)
    hiddenEvents.dispose()
    hiddenRuntime.destroy()
  })

  it('routes history commands through polygonal zone draft vertices before scene history', async () => {
    const runtime = new SceneCanvasRuntime()
    const { container } = await initRuntimeWithStubbedRenderer(runtime)
    const events = createSceneInteractionEventHarness(container)
    runtime.documentSurface.loadDocument(makeFile())
    setInteractionViewport(runtime)
    runtime.commandSurface.tools.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 })
    events.pointerDown({ x: 60, y: 10 })
    events.pointerMove({ x: 60, y: 50 })

    expect(runtime.commandSurface.history.canUndo.value).toBe(true)
    expect(runtime.commandSurface.history.canRedo.value).toBe(false)

    runtime.commandSurface.history.undo()

    const afterUndo = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(afterUndo?.getAttribute('points')).toBe('10,10 60,50')
    expect(runtime.querySurface.getSceneSnapshot().zones).toHaveLength(1)
    expect(runtime.commandSurface.history.canRedo.value).toBe(true)

    runtime.commandSurface.history.redo()

    const afterRedo = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(afterRedo?.getAttribute('points')).toBe('10,10 60,10 60,50')
    expect(runtime.querySurface.getSceneSnapshot().zones).toHaveLength(1)
    events.dispose()
    runtime.destroy()
  })

  it('invalidates the scene after select-all and lock mutations', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.documentSurface.loadDocument(makeFile())
    const invalidate = vi.spyOn(runtime as any, '_invalidate')

    invalidate.mockClear()
    runtime.commandSurface.sceneEdits.selectAll()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenLastCalledWith('scene')

    invalidate.mockClear()
    runtime.commandSurface.sceneEdits.lockSelected()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenLastCalledWith('scene')

    invalidate.mockClear()
    runtime.commandSurface.sceneEdits.unlockSelected()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('locks selected Design Objects through scene edit history and serialization', () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = new SceneCanvasRuntime({ appAdapter: cleanState.adapter })
    const file = fileWithOnlyPlants('plant-1')
    runtime.documentSurface.loadDocument(file)
    runtime.documentSurface.captureForPersistence({ name: file.name }, file).acknowledgeSaved()
    cleanState.setCanvasClean.mockClear()

    runtime.commandSurface.sceneEdits.selectAll()
    runtime.commandSurface.sceneEdits.lockSelected()

    expect(runtime.documentSurface.captureForPersistence({ name: file.name }, file).content.plants.find((plant) => plant.id === 'plant-1')?.locked)
      .toBe(true)
    expect(runtime.querySurface.getSelection().size).toBe(0)
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)
    expect(runtime.commandSurface.history.canUndo.value).toBe(true)

    runtime.commandSurface.history.undo()
    expect(runtime.documentSurface.captureForPersistence({ name: file.name }, file).content.plants.find((plant) => plant.id === 'plant-1')?.locked)
      .toBe(false)

    runtime.commandSurface.history.redo()
    expect(runtime.documentSurface.captureForPersistence({ name: file.name }, file).content.plants.find((plant) => plant.id === 'plant-1')?.locked)
      .toBe(true)

    runtime.commandSurface.sceneEdits.unlockSelected()
    expect(runtime.documentSurface.captureForPersistence({ name: file.name }, file).content.plants.find((plant) => plant.id === 'plant-1')?.locked)
      .toBe(true)
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
    runtime.documentSurface.loadDocument(file)
    runtime.documentSurface.captureForPersistence({ name: file.name }, file).acknowledgeSaved()
    cleanState.setCanvasClean.mockClear()

    expect(runtime.commandSurface.layers.setSceneLayerVisibility('plants', false)).toBe(true)
    expect(runtime.commandSurface.layers.setSceneLayerOpacity('zones', 0.4)).toBe(true)
    expect(runtime.commandSurface.layers.setSceneLayerLocked('zones', true)).toBe(true)

    const serialized = runtime.documentSurface.captureForPersistence({ name: file.name }, file).content

    expect(serialized.layers.find((layer) => layer.name === 'plants')?.visible).toBe(false)
    expect(serialized.layers.find((layer) => layer.name === 'zones')?.opacity).toBe(0.4)
    expect(serialized.layers.find((layer) => layer.name === 'zones')?.locked).toBe(true)
    expect(layerVisibility.value.plants).toBe(false)
    expect(layerOpacity.value.zones).toBe(0.4)
    expect(layerLockState.value.zones).toBe(true)
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)
    expect(runtime.commandSurface.history.canUndo.value).toBe(true)

    runtime.commandSurface.history.undo()
    expect(runtime.documentSurface.captureForPersistence({ name: file.name }, file).content.layers.find((layer) => layer.name === 'zones')?.locked)
      .toBe(false)
    expect(layerLockState.value.zones).toBe(false)

    runtime.commandSurface.history.redo()
    expect(runtime.documentSurface.captureForPersistence({ name: file.name }, file).content.layers.find((layer) => layer.name === 'zones')?.locked)
      .toBe(true)
    expect(layerLockState.value.zones).toBe(true)

    runtime.destroy()
  })

  it('edits guides through the scene edit history and projection signals', () => {
    const cleanState = createCleanStateAdapterProbe()
    const runtime = new SceneCanvasRuntime({ appAdapter: cleanState.adapter })
    const file = makeFile()
    runtime.documentSurface.loadDocument(file)
    runtime.documentSurface.captureForPersistence({ name: file.name }, file).acknowledgeSaved()
    cleanState.setCanvasClean.mockClear()

    ;(runtime as any)._addGuide('v', 42)

    const serialized = runtime.documentSurface.captureForPersistence({ name: file.name }, file).content
    expect(serialized.extra).toEqual({
      guides: [{ id: expect.any(String), axis: 'v', position: 42 }],
    })
    expect(guides.value).toEqual([{ id: expect.any(String), axis: 'v', position: 42 }])
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)

    runtime.commandSurface.history.undo()
    expect(runtime.documentSurface.captureForPersistence({ name: file.name }, file).content.extra).toEqual({})
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
    runtime.documentSurface.loadDocument(file)
    runtime.documentSurface.captureForPersistence({ name: file.name }, file).acknowledgeSaved()
    cleanState.setCanvasClean.mockClear()

    const changed = runtime.commandSurface.plantPresentation.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(0)
    expect(lastCleanState(cleanState.setCanvasClean)).toBe(false)
    expect(runtime.documentSurface.captureForPersistence({ name: file.name }, file).content.plant_species_colors).toEqual({
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
    runtime.documentSurface.loadDocument(makeFile())
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

  it('keeps pinned plant name labels visible and localized in renderer snapshots', async () => {
    vi.mocked(getCommonNames)
      .mockResolvedValueOnce({ 'Malus domestica': 'Apple' })
      .mockResolvedValueOnce({ 'Malus domestica': 'Pommier' })

    const runtime = new SceneCanvasRuntime({
      appAdapter: createAppCanvasRuntimeAppAdapter(),
    })
    runtime.documentSurface.loadDocument(makeFile())
    const { renderer } = await initRuntimeWithStubbedRenderer(runtime)
    runtime.commandSurface.sceneEdits.selectAll()
    runtime.commandSurface.sceneEdits.toggleSelectedPlantNamePins()
    expect(runtime.querySurface.getSceneSnapshot().plants.map((plant) => plant.pinnedName)).toEqual([true, true])

    await vi.waitFor(() => {
      const snapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
      expect(snapshot?.pinnedPlantNameLabels?.map((label: PlantNameLabel) => label.text)).toEqual(['Apple', 'Apple'])
    })
    const initialRenderCount = renderer.renderScene.mock.calls.length

    locale.value = 'fr'
    await vi.waitFor(() => {
      expect(renderer.renderScene.mock.calls.length).toBeGreaterThan(initialRenderCount)
    })

    const localizedSnapshot = renderer.renderScene.mock.calls[renderer.renderScene.mock.calls.length - 1]?.[0]
    expect(localizedSnapshot?.pinnedPlantNameLabels?.map((label: PlantNameLabel) => label.text)).toEqual(['Pommier', 'Pommier'])
    runtime.destroy()
  })

  it('uses localized common names in selected plant presentation contexts', async () => {
    vi.mocked(getCommonNames).mockImplementation(async (_canonicalNames, activeLocale) => ({
      'Malus domestica': activeLocale === 'fr' ? 'Pommier' : 'Apple',
    }))

    const runtime = new SceneCanvasRuntime({
      appAdapter: createAppCanvasRuntimeAppAdapter(),
    })
    runtime.documentSurface.loadDocument(makeFile())
    runtime.commandSurface.sceneEdits.selectAll()

    locale.value = 'fr'
    await runtime.commandSurface.plantPresentation.ensureSpeciesCacheEntries(['Malus domestica'], 'fr')

    expect(getCommonNames).toHaveBeenCalledWith(['Malus domestica'], 'fr')
    expect(runtime.querySurface.getLocalizedCommonNames().get('Malus domestica')).toBe('Pommier')
    expect(runtime.querySurface.getSelectedPlantColorContext().singleSpeciesCommonName).toBe('Pommier')
    expect(runtime.querySurface.getSelectedPlantSymbolContext().singleSpeciesCommonName).toBe('Pommier')
  })
})
