import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPlantStampSource,
  readPlantStampSource,
  selectPlantStampSource,
  writePlantStampDragData,
} from '../canvas/plant-stamp-source'
import {
  clearSavedObjectStampSource,
  selectSavedObjectStampSource,
  writeSavedObjectStampDragData,
} from '../canvas/saved-object-stamp-source'
import { guides } from '../canvas/scene-metadata-state'
import { selectedObjectIds } from '../canvas/session-state'
import { snapToGridEnabled, snapToGuidesEnabled } from '../app/canvas-settings/signals'
import { plantSpacingIntervalM } from '../app/settings/state'
import { CameraController } from '../canvas/runtime/camera'
import {
  SceneStore,
  type SceneAnnotationEntity,
  type SceneMeasurementGuideEntity,
  type ScenePlantEntity,
  type ScenePoint,
  type SceneZoneEntity,
} from '../canvas/runtime/scene'
import { SceneInteractionController, type SceneInteractionDeps } from '../canvas/runtime/scene-interaction'
import type { CanvasDesignObjectSelectionModel } from '../canvas/runtime/runtime'
import { getDesignObjectSelectionModel } from '../canvas/runtime/scene-runtime/selection'
import { SceneRuntimeEditCoordinator } from '../canvas/runtime/scene-runtime/transactions'
import {
  CANVAS_NOTICE_MARGIN_PX,
  CANVAS_RULER_SIZE_PX,
} from '../canvas/canvas-notice-layout'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
  type SceneInteractionPointerOptions,
} from './support/scene-interaction-frame'

function createPlantPresentationContext(viewportScale: number) {
  return {
    viewport: { x: 0, y: 0, scale: viewportScale },
    sizeMode: 'default' as const,
    colorByAttr: null,
    speciesCache: new Map(),
  }
}

function createInteractionDeps(
  container: HTMLDivElement,
  store: SceneStore,
  camera: CameraController,
  overrides: Partial<Pick<SceneInteractionDeps,
    | 'render'
    | 'sceneEdits'
    | 'getDesignObjectSelection'
    | 'selectionCommands'
    | 'setTool'
    | 'setHoveredEntityId'
    | 'setViewport'
    | 'getPlantPresentationContext'
    | 'readPlantSpacingIntervalMeters'
    | 'commitPlantSpacingIntervalMeters'
  >>
    & { onSceneEditCommit?: (type: string) => void } = {},
): SceneInteractionDeps {
  let selection = new Set<string>()
  const setSelection = vi.fn((ids: Iterable<string>) => {
    selection = new Set(ids)
    store.setSelection(selection)
    selectedObjectIds.value = new Set(selection)
  })
  const clearSelection = vi.fn(() => {
    selection = new Set()
    store.setSelection(selection)
    selectedObjectIds.value = new Set()
  })
  const render = (overrides.render ?? (() => {})) as SceneInteractionDeps['render']
  const sceneEdits = overrides.sceneEdits ?? new SceneRuntimeEditCoordinator({
    sceneStore: store,
    captureSnapshot: () => {
      const snapshot = store.snapshot()
      return {
        persisted: snapshot.persisted,
        session: snapshot.session,
      }
    },
    markDirty: (_before, type) => {
      overrides.onSceneEditCommit?.(type ?? 'scene-mutation')
      return true
    },
    setSelection,
    invalidate: (kind) => {
      if (kind === 'scene' || kind === 'viewport') render(kind)
    },
  })

  return {
    container,
    getSceneStore: () => store,
    camera,
    setViewport: (overrides.setViewport ?? ((viewport) => {
      store.setViewport(viewport)
    })) as SceneInteractionDeps['setViewport'],
    getSpeciesCache: () => new Map(),
    getPlantPresentationContext: overrides.getPlantPresentationContext ?? createPlantPresentationContext,
    getSelection: () => new Set(selection),
    setSelection,
    clearSelection,
    sceneEdits,
    getDesignObjectSelection: overrides.getDesignObjectSelection ?? (() =>
      getDesignObjectSelectionFromStore(store, camera)
    ),
    selectionCommands: overrides.selectionCommands ?? {
      copy: vi.fn(),
      pasteAt: vi.fn(),
      canPaste: vi.fn(() => false),
      duplicateSelected: vi.fn(),
      toggleSelectedPlantNamePins: vi.fn(),
      deleteSelected: vi.fn(),
      bringToFront: vi.fn(),
      sendToBack: vi.fn(),
      selectSameSpecies: vi.fn(),
      lockSelected: vi.fn(),
      unlockSelected: vi.fn(),
      groupSelected: vi.fn(),
      ungroupSelected: vi.fn(),
    },
    setTool: (overrides.setTool ?? ((name: string) => {
      void name
    })) as SceneInteractionDeps['setTool'],
    render,
    readSnapToGridEnabled: () => snapToGridEnabled.value,
    readSnapToGuidesEnabled: () => snapToGuidesEnabled.value,
    readPlantSpacingIntervalMeters: overrides.readPlantSpacingIntervalMeters ?? (() => plantSpacingIntervalM.value),
    commitPlantSpacingIntervalMeters: overrides.commitPlantSpacingIntervalMeters ?? ((meters) => {
      plantSpacingIntervalM.value = meters
    }),
    setHoveredEntityId: overrides.setHoveredEntityId ?? (() => {}),
    getLocalizedCommonNames: () => new Map(),
  }
}

function withoutNativeRandomUUID(action: () => void): void {
  const originalCrypto = globalThis.crypto
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues<T extends ArrayBufferView>(array: T): T {
        return originalCrypto.getRandomValues(array)
      },
    },
  })

  try {
    action()
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
  }
}

function zoneMeasurementTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-zone-measurement-label]'))
    .map((label) => label.textContent ?? '')
}

function plantHoverTooltip(container: HTMLElement): HTMLElement {
  const tooltip = container.querySelector<HTMLElement>('[data-hover-tooltip]')
  if (!tooltip) throw new Error('Expected Plant Hover Tooltip')
  return tooltip
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function makePlant(
  id: string,
  canonicalName: string,
  position: { x: number; y: number },
  overrides: Partial<ScenePlantEntity> = {},
): ScenePlantEntity {
  return {
    kind: 'plant',
    id,
    locked: false,
    canonicalName,
    commonName: canonicalName,
    color: null,
    stratum: null,
    canopySpreadM: 2,
    position,
    rotationDeg: null,
    scale: 2,
    notes: null,
    plantedDate: null,
    quantity: 1,
    ...overrides,
  }
}

function makeRectZone(
  name: string,
  points: SceneZoneEntity['points'],
  overrides: Partial<SceneZoneEntity> = {},
): SceneZoneEntity {
  return {
    kind: 'zone',
    name,
    locked: false,
    zoneType: 'rect',
    points,
    rotationDeg: 0,
    fillColor: null,
    notes: null,
    ...overrides,
  }
}

function makeTextAnnotation(
  id: string,
  position: ScenePoint,
  text: string,
  overrides: Partial<SceneAnnotationEntity> = {},
): SceneAnnotationEntity {
  return {
    kind: 'annotation',
    id,
    locked: false,
    annotationType: 'text',
    position,
    text,
    fontSize: 16,
    rotationDeg: null,
    ...overrides,
  }
}

function makeMeasurementGuide(
  id: string,
  start: ScenePoint,
  end: ScenePoint,
  overrides: Partial<SceneMeasurementGuideEntity> = {},
): SceneMeasurementGuideEntity {
  return {
    kind: 'measurement-guide',
    id,
    locked: false,
    start,
    end,
    ...overrides,
  }
}

function getDesignObjectSelectionFromStore(
  store: SceneStore,
  camera: CameraController,
): CanvasDesignObjectSelectionModel {
  return getDesignObjectSelectionModel(
    store.persisted,
    store.session.selectedEntityIds,
    {
      annotationViewportScale: camera.viewport.scale,
      plantContext: createPlantPresentationContext(camera.viewport.scale),
    },
  )
}

function rotationHandleCenter(container: HTMLElement): ScenePoint {
  const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')
  if (!handle) throw new Error('Expected rotation handle to be visible')
  if (handle.style.display === 'none') throw new Error('Expected rotation handle to be visible')
  const left = Number.parseFloat(handle.style.left)
  const top = Number.parseFloat(handle.style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    throw new Error('Expected rotation handle to be positioned')
  }
  return {
    x: left + 14,
    y: top + 14,
  }
}

function zoneControlPointCenter(container: HTMLElement, kind: string, index: number): ScenePoint {
  const handle = container.querySelector<HTMLElement>(
    `[data-zone-control-point-kind="${kind}"][data-zone-control-point-index="${index}"]`,
  )
  if (!handle) throw new Error(`Expected ${kind} Zone Control Point ${index}`)
  const screenX = Number.parseFloat(handle.dataset.zoneControlPointScreenX ?? '')
  const screenY = Number.parseFloat(handle.dataset.zoneControlPointScreenY ?? '')
  if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
    return { x: screenX, y: screenY }
  }
  const left = Number.parseFloat(handle.style.left)
  const top = Number.parseFloat(handle.style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    throw new Error('Expected Zone Control Point to be positioned')
  }
  return {
    x: left + 10,
    y: top + 10,
  }
}

function measurementGuideControlPointCenter(container: HTMLElement, index: number): ScenePoint {
  const handle = container.querySelector<HTMLElement>(
    `[data-measurement-guide-control-point-index="${index}"]`,
  )
  if (!handle) throw new Error(`Expected Measurement Guide Control Point ${index}`)
  const screenX = Number.parseFloat(handle.dataset.measurementGuideControlPointScreenX ?? '')
  const screenY = Number.parseFloat(handle.dataset.measurementGuideControlPointScreenY ?? '')
  if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
    return { x: screenX, y: screenY }
  }
  const left = Number.parseFloat(handle.style.left)
  const top = Number.parseFloat(handle.style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    throw new Error('Expected Measurement Guide Control Point to be positioned')
  }
  return {
    x: left + 10,
    y: top + 10,
  }
}

function selectionBoundsCenter(selection: CanvasDesignObjectSelectionModel): ScenePoint {
  if (!selection.bounds) throw new Error('Expected selection bounds')
  return {
    x: selection.bounds.minX + (selection.bounds.maxX - selection.bounds.minX) / 2,
    y: selection.bounds.minY + (selection.bounds.maxY - selection.bounds.minY) / 2,
  }
}

function quarterTurnClockwise(pivot: ScenePoint, point: ScenePoint): ScenePoint {
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  return {
    x: pivot.x - dy,
    y: pivot.y + dx,
  }
}

function expectPointCloseTo(actual: ScenePoint | undefined, expected: ScenePoint): void {
  expect(actual?.x).toBeCloseTo(expected.x)
  expect(actual?.y).toBeCloseTo(expected.y)
}

function pointerMoveWithEventTarget(
  events: SceneInteractionEventHarness,
  screen: ScenePoint,
  target: EventTarget,
  options: SceneInteractionPointerOptions = {},
): PointerEvent {
  const {
    pointerId = 1,
    pointerType = 'mouse',
    isPrimary = true,
    button = 0,
    buttons = 1,
    bubbles = true,
    cancelable = true,
    target: _dispatchTarget,
    ...mouseOptions
  } = options
  const client = events.clientPoint(screen)
  const event = new MouseEvent('pointermove', {
    ...mouseOptions,
    bubbles,
    cancelable,
    button,
    buttons,
    clientX: client.x,
    clientY: client.y,
  })
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    pointerType: { configurable: true, value: pointerType },
    isPrimary: { configurable: true, value: isPrimary },
    target: { configurable: true, value: target },
  })
  window.dispatchEvent(event)
  return event as PointerEvent
}

function pointsCenter(points: readonly ScenePoint[]): ScenePoint {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return {
    x: minX + (maxX - minX) / 2,
    y: minY + (maxY - minY) / 2,
  }
}

describe('SceneInteractionController', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    events = createSceneInteractionEventHarness(container)

    camera = new CameraController()
    camera.initialize({ width: 400, height: 300 })
    camera.setViewport({ x: 0, y: 0, scale: 1 })
    store = new SceneStore()
    selectedObjectIds.value = new Set()
    clearPlantStampSource()
    clearSavedObjectStampSource()
    snapToGridEnabled.value = false
    snapToGuidesEnabled.value = false
    guides.value = []
    plantSpacingIntervalM.value = 0.5
  })

  afterEach(() => {
    events.dispose()
    container.remove()
    selectedObjectIds.value = new Set()
    clearPlantStampSource()
    clearSavedObjectStampSource()
    snapToGridEnabled.value = false
    snapToGuidesEnabled.value = false
    guides.value = []
    plantSpacingIntervalM.value = 0.5
  })

  it('selects and drags a plant in scene space', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'plant-1',
        locked: false,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const render = vi.fn()
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render, onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 20, y: 30 })
    events.pointerMove({ x: 35, y: 45 })
    events.pointerUp({ x: 35, y: 45 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    expect(deps.setSelection).toHaveBeenCalledWith(new Set(['plant-1']))
    controller.dispose()
  })

  it('shows the two nearest non-dragged Placed Plant distances while dragging selected Plants', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 0, y: 0 }),
        makePlant('plant-2', 'Malus domestica', { x: -20, y: -20 }),
        makePlant('plant-3', 'Pyrus communis', { x: 6, y: 8 }),
        makePlant('plant-4', 'Prunus avium', { x: 3, y: 9 }),
        makePlant('plant-5', 'Cydonia oblonga', { x: 13, y: 4 }),
        makePlant('plant-6', 'Mespilus germanica', { x: 103, y: 4 }),
      ]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['plant-1', 'plant-2'])

    events.pointerDown({ x: 0, y: 0 })
    events.pointerMove({ x: 3, y: 4 })

    const labels = Array.from(container.querySelectorAll<HTMLElement>('[data-plant-drag-distance-label]'))
    const lines = Array.from(container.querySelectorAll<SVGLineElement>('[data-plant-drag-distance-line]'))

    expect(store.persisted.plants.find((plant) => plant.id === 'plant-1')?.position).toEqual({ x: 3, y: 4 })
    expect(labels.map((label) => label.textContent)).toEqual(['5 m', '5 m'])
    expect(lines).toHaveLength(2)
    expect(container.textContent).not.toContain('10 m')
    expect(container.textContent).not.toContain('100 m')
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerUp({ x: 3, y: 4 })

    expect(container.querySelector('[data-plant-drag-distance-label]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    controller.dispose()
  })

  it('hides Selection Action Toolbar and Rotation Handle while dragging a selected Design Object', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()
    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    expect(toolbar.style.display).toBe('flex')
    expect(handle.style.display).toBe('inline-flex')

    events.pointerDown({ x: 20, y: 110 }, { button: 0 })

    expect(toolbar.style.display).toBe('none')
    expect(handle.style.display).toBe('none')

    events.pointerMove({ x: 40, y: 130 }, { button: 0 })
    events.pointerUp({ x: 40, y: 130 }, { button: 0 })

    expect(toolbar.style.display).toBe('flex')
    expect(handle.style.display).toBe('inline-flex')
    controller.dispose()
  })

  it('clears Plant Hover Tooltip presentation while dragging a selected Plant', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 }, { commonName: 'Apple' })]
    })
    const setHoveredEntityId = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setHoveredEntityId })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['plant-1'])

    events.pointerMove({ x: 20, y: 30 })
    const tooltip = plantHoverTooltip(container)
    expect(tooltip.style.display).toBe('block')
    expect(setHoveredEntityId).toHaveBeenCalledWith('plant-1')
    setHoveredEntityId.mockClear()

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    expect(tooltip.style.display).toBe('none')
    expect(setHoveredEntityId).toHaveBeenCalledWith(null)

    events.pointerMove({ x: 35, y: 45 }, { button: 0 })
    events.pointerUp({ x: 35, y: 45 }, { button: 0 })

    expect(tooltip.style.display).toBe('none')
    controller.dispose()
  })

  it('restores selection overlays after a no-op Design Object drag without history', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()
    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!

    events.pointerDown({ x: 20, y: 110 }, { button: 0 })
    expect(toolbar.style.display).toBe('none')
    expect(handle.style.display).toBe('none')
    events.pointerUp({ x: 20, y: 110 }, { button: 0 })

    expect(toolbar.style.display).toBe('flex')
    expect(handle.style.display).toBe('inline-flex')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('restores selection overlays when a Design Object drag is canceled by a tool change', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()
    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!

    events.pointerDown({ x: 20, y: 110 }, { button: 0 })
    events.pointerMove({ x: 40, y: 130 }, { button: 0 })
    expect(toolbar.style.display).toBe('none')
    expect(handle.style.display).toBe('none')
    controller.setTool('rectangle')

    expect(toolbar.style.display).toBe('none')
    expect(handle.style.display).toBe('none')
    expect(store.persisted.zones[0]?.points[0]).toEqual({ x: 20, y: 80 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('keeps active drag and rotation gestures moving when pointermove targets runtime overlays', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
      draft.zones = [makeRectZone('zone-1', [
        { x: 80, y: 80 },
        { x: 140, y: 80 },
        { x: 140, y: 120 },
        { x: 80, y: 120 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    deps.setSelection(['plant-1'])
    controller.refreshMeasurements()
    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    expect(toolbar.style.display).toBe('flex')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    const toolbarMove = pointerMoveWithEventTarget(events, { x: 35, y: 45 }, toolbar, { button: 0 })
    expect(toolbarMove.target).toBe(toolbar)
    events.pointerUp({ x: 35, y: 45 }, { button: 0 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')

    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const lockedAffordance = container.querySelector<HTMLElement>('[data-locked-object-affordance]')!
    const pivot = selectionBoundsCenter(getDesignObjectSelectionFromStore(store, camera))
    const start = rotationHandleCenter(container)
    const end = quarterTurnClockwise(pivot, start)

    events.pointerDown(start, { button: 0, target: handle })
    const affordanceMove = pointerMoveWithEventTarget(events, end, lockedAffordance, { button: 0 })
    expect(affordanceMove.target).toBe(lockedAffordance)

    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)

    events.pointerUp(end, { button: 0 })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    controller.dispose()
  })

  it('selects all visible editable same-Species plants on Select-tool double-click without scene edits', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('apple-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('apple-2', 'Malus domestica', { x: 620, y: 30 }),
        makePlant('pear-1', 'Pyrus communis', { x: 80, y: 30 }),
        makePlant('locked-apple', 'Malus domestica', { x: 120, y: 30 }, { locked: true }),
        makePlant('grouped-apple', 'Malus domestica', { x: 160, y: 30 }),
      ]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: null,
        members: [{ kind: 'plant', id: 'grouped-apple' }],
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 1 })
    vi.mocked(deps.setSelection).mockClear()

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 2 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 2 })

    expect(selectedObjectIds.value).toEqual(new Set(['apple-1', 'apple-2']))
    expect(deps.setSelection).toHaveBeenCalledWith(new Set(['apple-1', 'apple-2']))
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('toggles same-Species plant sets with Shift double-click', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('apple-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('apple-2', 'Malus domestica', { x: 80, y: 30 }),
        makePlant('pear-1', 'Pyrus communis', { x: 140, y: 30 }),
      ]
    })
    const deps = createInteractionDeps(container, store, camera)
    deps.setSelection(['apple-1', 'apple-2', 'pear-1'])
    vi.mocked(deps.setSelection).mockClear()
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 2, shiftKey: true })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 2, shiftKey: true })

    expect(selectedObjectIds.value).toEqual(new Set(['pear-1']))

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 2, shiftKey: true })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 2, shiftKey: true })

    expect(selectedObjectIds.value).toEqual(new Set(['pear-1', 'apple-1', 'apple-2']))
    controller.dispose()
  })

  it('does not run Species Selection outside the Select tool', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('apple-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('apple-2', 'Malus domestica', { x: 80, y: 30 }),
      ]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('hand')

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 2 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 2 })

    expect(selectedObjectIds.value).toEqual(new Set())
    expect(deps.setSelection).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('shows a focus-preserving Selection Action Toolbar near editable selections', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    const priorFocus = document.createElement('button')
    document.body.appendChild(priorFocus)
    priorFocus.focus()
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'zone' as const, id: 'zone-1' }],
        blockedTargets: [],
        bounds: { minX: 160, minY: 100, maxX: 220, maxY: 150 },
        sameSpeciesReferenceCanonicalName: null,
      }),
      selectionCommands: {
        duplicateSelected: vi.fn(),
        toggleSelectedPlantNamePins: vi.fn(),
        deleteSelected: vi.fn(),
        bringToFront: vi.fn(),
        sendToBack: vi.fn(),
        selectSameSpecies: vi.fn(),
        lockSelected: vi.fn(),
        unlockSelected: vi.fn(),
        groupSelected: vi.fn(),
        ungroupSelected: vi.fn(),
      },
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()

    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.style.display).toBe('flex')
    expect(toolbar?.getAttribute('role')).toBe('toolbar')
    expect(toolbar?.getAttribute('aria-label')).toBe('Selection actions')
    expect(document.activeElement).toBe(priorFocus)
    expect(Number.parseFloat(toolbar?.style.top ?? '0')).toBe(158)
    expect(toolbar?.querySelectorAll('button')).toHaveLength(5)
    const duplicate = toolbar?.querySelector<HTMLButtonElement>('[data-selection-action-command="duplicate"]')
    expect(duplicate?.getAttribute('aria-label')).toContain('Duplicate')
    expect(duplicate?.querySelector('svg')).not.toBeNull()
    const duplicateIconStrokes = Array.from(duplicate?.querySelectorAll<SVGElement>('path, polyline') ?? [])
      .map((element) => element.getAttribute('stroke-width'))
    expect(duplicateIconStrokes).toEqual(['1.5', '1.5'])
    expect(duplicate?.querySelector('[data-selection-action-tooltip]')?.textContent).toContain('Duplicate')

    controller.dispose()
    priorFocus.remove()
  })

  it('shows a Selection Action Toolbar plant-name pin button only for editable plant selections', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    const toggleSelectedPlantNamePins = vi.fn()
    let selection: CanvasDesignObjectSelectionModel = {
      editableTargets: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
      ],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 160, minY: 100, maxX: 220, maxY: 150 },
      sameSpeciesReferenceCanonicalName: null,
      plantNamePinning: {
        plantIds: ['plant-1'],
        allPinned: false,
      },
    }
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => selection,
      selectionCommands: {
        duplicateSelected: vi.fn(),
        toggleSelectedPlantNamePins,
        deleteSelected: vi.fn(),
        bringToFront: vi.fn(),
        sendToBack: vi.fn(),
        selectSameSpecies: vi.fn(),
        lockSelected: vi.fn(),
        unlockSelected: vi.fn(),
        groupSelected: vi.fn(),
        ungroupSelected: vi.fn(),
      },
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()
    const pin = container.querySelector<HTMLButtonElement>('[data-selection-action-command="pin-plant-name"]')!
    expect(pin).not.toBeNull()
    expect(pin.getAttribute('aria-label')).toBe('Pin plant name')
    pin.click()
    expect(toggleSelectedPlantNamePins).toHaveBeenCalledTimes(1)

    selection = {
      ...selection,
      editableTargets: [{ kind: 'zone', id: 'zone-1' }],
      plantNamePinning: {
        plantIds: [],
        allPinned: false,
      },
    }
    controller.refreshMeasurements()
    expect(container.querySelector('[data-selection-action-command="pin-plant-name"]')).toBeNull()
    controller.dispose()
  })

  it('refreshes the Selection Action Toolbar plant-name pin action while it stays mounted', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    const makeSelection = (allPinned: boolean): CanvasDesignObjectSelectionModel => ({
      editableTargets: [{ kind: 'plant', id: 'plant-1' }],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 160, minY: 100, maxX: 220, maxY: 150 },
      sameSpeciesReferenceCanonicalName: null,
      plantNamePinning: {
        plantIds: ['plant-1'],
        allPinned,
      },
    })
    let selection = makeSelection(false)
    const toggleSelectedPlantNamePins = vi.fn(() => {
      selection = makeSelection(!selection.plantNamePinning!.allPinned)
    })
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => selection,
      selectionCommands: {
        duplicateSelected: vi.fn(),
        toggleSelectedPlantNamePins,
        deleteSelected: vi.fn(),
        bringToFront: vi.fn(),
        sendToBack: vi.fn(),
        selectSameSpecies: vi.fn(),
        lockSelected: vi.fn(),
        unlockSelected: vi.fn(),
        groupSelected: vi.fn(),
        ungroupSelected: vi.fn(),
      },
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()
    const pin = container.querySelector<HTMLButtonElement>('[data-selection-action-command="pin-plant-name"]')!
    expect(pin).not.toBeNull()
    expect(pin.getAttribute('aria-label')).toBe('Pin plant name')

    pin.click()

    expect(toggleSelectedPlantNamePins).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-selection-action-command="pin-plant-name"]')).toBeNull()
    const unpin = container.querySelector<HTMLButtonElement>('[data-selection-action-command="unpin-plant-name"]')!
    expect(unpin).not.toBeNull()
    expect(unpin).not.toBe(pin)
    expect(unpin.getAttribute('aria-label')).toBe('Unpin plant name')
    expect(unpin.querySelector('[data-selection-action-tooltip]')?.textContent).toContain('Unpin plant name')

    unpin.click()

    expect(toggleSelectedPlantNamePins).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-selection-action-command="unpin-plant-name"]')).toBeNull()
    const pinAgain = container.querySelector<HTMLButtonElement>('[data-selection-action-command="pin-plant-name"]')!
    expect(pinAgain).not.toBeNull()
    expect(pinAgain.getAttribute('aria-label')).toBe('Pin plant name')
    expect(pinAgain.querySelector('[data-selection-action-tooltip]')?.textContent).toContain('Pin plant name')
    controller.dispose()
  })

  it('keeps the Selection Action Toolbar close above a single non-rotatable Plant', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'plant' as const, id: 'plant-1' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 100, minY: 100, maxX: 100, maxY: 100 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()

    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    expect(toolbar.style.display).toBe('flex')
    expect(Number.parseFloat(toolbar.style.top)).toBe(58)
    controller.dispose()
  })

  it('flips the Selection Action Toolbar near top and bottom canvas edges', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 200 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 140 })
    let bounds = { minX: 80, minY: 6, maxX: 80, maxY: 6 }
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'plant' as const, id: 'plant-1' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds,
        sameSpeciesReferenceCanonicalName: null,
      }),
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()

    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    expect(Number.parseFloat(toolbar.style.top)).toBe(14)

    bounds = { minX: 80, minY: 116, maxX: 80, maxY: 116 }
    controller.refreshMeasurements()

    expect(Number.parseFloat(toolbar.style.top)).toBe(74)
    expect(Number.parseFloat(toolbar.style.top) + 34).toBeLessThanOrEqual(140 - 8)
    controller.dispose()
  })

  it('keeps the Selection Action Toolbar clear of the Rotation Handle near the bottom edge', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 160, y: 260 },
        { x: 220, y: 260 },
        { x: 220, y: 292 },
        { x: 160, y: 292 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['zone-1'])

    controller.refreshMeasurements()

    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const toolbarTop = Number.parseFloat(toolbar.style.top)
    const handleTop = Number.parseFloat(handle.style.top)

    expect(toolbar.style.display).toBe('flex')
    expect(handle.style.display).toBe('inline-flex')
    expect(toolbarTop + 34).toBeLessThanOrEqual(handleTop)
    expect(toolbarTop).toBeGreaterThanOrEqual(8)
    controller.dispose()
  })

  it('keeps the Selection Action Toolbar inside the right canvas edge', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 200 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'zone' as const, id: 'zone-1' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 186, minY: 100, maxX: 198, maxY: 150 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()

    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    const buttonCount = toolbar.querySelectorAll('button').length
    const renderedWidthPx = buttonCount * 28 + (buttonCount - 1) * 4 + 8
    const left = Number.parseFloat(toolbar.style.left)

    expect(toolbar.style.display).toBe('flex')
    expect(buttonCount).toBe(5)
    expect(left + renderedWidthPx).toBeLessThanOrEqual(200 - 8)
    controller.dispose()
  })

  it('keeps Selection Action Toolbar tooltips above the Rotation Handle', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 160, y: 120 },
        { x: 220, y: 120 },
        { x: 220, y: 170 },
        { x: 160, y: 170 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)

    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()

    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const duplicate = toolbar.querySelector<HTMLButtonElement>('[data-selection-action-command="duplicate"]')!
    const tooltip = duplicate.querySelector<HTMLElement>('[data-selection-action-tooltip]')!
    duplicate.dispatchEvent(new Event('pointerenter'))

    expect(toolbar.style.display).toBe('flex')
    expect(handle.style.display).toBe('inline-flex')
    expect(tooltip.style.display).toBe('inline-flex')
    expect(tooltip.style.bottom).toBe('100%')
    expect(tooltip.style.marginBottom).toBe('var(--space-1)')
    expect(tooltip.style.top).toBe('')
    expect(Number.parseInt(toolbar.style.zIndex, 10)).toBeGreaterThan(Number.parseInt(handle.style.zIndex, 10))
    controller.dispose()
  })

  it('clears Selection Action Toolbar tooltips when selection refreshes with unchanged actions', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    store.updatePersisted((draft) => {
      draft.zones = [
        makeRectZone('zone-1', [
          { x: 80, y: 80 },
          { x: 140, y: 80 },
          { x: 140, y: 120 },
          { x: 80, y: 120 },
        ]),
        makeRectZone('zone-2', [
          { x: 180, y: 80 },
          { x: 240, y: 80 },
          { x: 240, y: 120 },
          { x: 180, y: 120 },
        ]),
      ]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)

    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()
    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    const duplicate = toolbar.querySelector<HTMLButtonElement>('[data-selection-action-command="duplicate"]')!
    const tooltip = duplicate.querySelector<HTMLElement>('[data-selection-action-tooltip]')!
    duplicate.dispatchEvent(new Event('pointerenter'))

    expect(toolbar.style.display).toBe('flex')
    expect(tooltip.style.display).toBe('inline-flex')

    deps.setSelection(['zone-2'])
    controller.refreshMeasurements()

    expect(toolbar.style.display).toBe('flex')
    expect(tooltip.style.display).toBe('none')
    expect(toolbar.querySelectorAll('button')).toHaveLength(5)
    controller.dispose()
  })

  it('hides Selection Action Toolbar, Rotation Handle, and stale tooltips outside Select affordance states', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 80, y: 80 },
        { x: 160, y: 80 },
        { x: 160, y: 140 },
        { x: 80, y: 140 },
      ])]
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 220, y: 100 }, 'Edit me')]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()

    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const duplicate = toolbar.querySelector<HTMLButtonElement>('[data-selection-action-command="duplicate"]')!
    const tooltip = duplicate.querySelector<HTMLElement>('[data-selection-action-tooltip]')!
    duplicate.dispatchEvent(new Event('pointerenter'))
    expect(toolbar.style.display).toBe('flex')
    expect(handle.style.display).toBe('inline-flex')
    expect(tooltip.style.display).toBe('inline-flex')

    controller.setTool('rectangle')

    expect(toolbar.style.display).toBe('none')
    expect(handle.style.display).toBe('none')
    expect(tooltip.style.display).toBe('none')

    controller.setTool('select')
    deps.setSelection(['annotation-1'])
    controller.refreshMeasurements()
    expect(toolbar.style.display).toBe('flex')
    expect(handle.style.display).toBe('inline-flex')

    events.keyDown({ key: 'F2', cancelable: true, target: container })

    expect(container.querySelector('textarea')).not.toBeNull()
    expect(toolbar.style.display).toBe('none')
    expect(handle.style.display).toBe('none')
    controller.dispose()
  })

  it('dispatches Selection Action Toolbar commands by mouse or focused key activation only', () => {
    const duplicateSelected = vi.fn()
    const deleteSelected = vi.fn()
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'zone' as const, id: 'zone-1' }],
        blockedTargets: [],
        bounds: { minX: 160, minY: 100, maxX: 220, maxY: 150 },
        sameSpeciesReferenceCanonicalName: null,
      }),
      selectionCommands: {
        duplicateSelected,
        deleteSelected,
        bringToFront: vi.fn(),
        sendToBack: vi.fn(),
        selectSameSpecies: vi.fn(),
        lockSelected: vi.fn(),
        unlockSelected: vi.fn(),
        groupSelected: vi.fn(),
        ungroupSelected: vi.fn(),
      },
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(duplicateSelected).not.toHaveBeenCalled()

    const duplicate = container.querySelector<HTMLButtonElement>('[data-selection-action-command="duplicate"]')!
    expect(duplicate.tabIndex).toBe(0)
    duplicate.click()
    expect(duplicateSelected).toHaveBeenCalledTimes(1)

    duplicate.focus()
    duplicate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(duplicateSelected).toHaveBeenCalledTimes(2)
    controller.refreshMeasurements()
    expect(document.activeElement).toBe(duplicate)

    const remove = container.querySelector<HTMLButtonElement>('[data-selection-action-command="delete"]')!
    remove.focus()
    remove.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(deleteSelected).toHaveBeenCalledTimes(1)

    controller.dispose()
  })

  it('dispatches Selection Action Toolbar Save as Saved Object Stamp for editable and locked selections', () => {
    const saveSelectionAsObjectStamp = vi.fn()
    let selectionModel: CanvasDesignObjectSelectionModel = {
      editableTargets: [{ kind: 'zone' as const, id: 'zone-1' }],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 160, minY: 100, maxX: 220, maxY: 150 },
      sameSpeciesReferenceCanonicalName: null,
    }
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => selectionModel,
      contextualCommands: {
        saveSelectionAsObjectStamp,
      },
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()
    const save = container.querySelector<HTMLButtonElement>(
      '[data-selection-action-command="save-object-stamp"]',
    )!
    expect(save).not.toBeNull()
    expect(save.disabled).toBe(false)
    expect(save.getAttribute('aria-label')).toContain('Save as Saved Stamp')
    save.click()
    expect(saveSelectionAsObjectStamp).toHaveBeenCalledTimes(1)

    selectionModel = {
      editableTargets: [],
      lockedTargets: [{ kind: 'plant' as const, id: 'locked-plant' }],
      blockedTargets: [{
        target: { kind: 'plant' as const, id: 'locked-plant' },
        reason: 'locked-design-object' as const,
        layerName: 'plants',
      }],
      bounds: { minX: 20, minY: 20, maxX: 24, maxY: 24 },
      sameSpeciesReferenceCanonicalName: null,
    }
    controller.refreshMeasurements()
    const lockedSave = container.querySelector<HTMLButtonElement>(
      '[data-selection-action-command="save-object-stamp"]',
    )!
    expect(lockedSave.disabled).toBe(false)
    lockedSave.click()
    expect(saveSelectionAsObjectStamp).toHaveBeenCalledTimes(2)

    selectionModel = {
      editableTargets: [{ kind: 'measurement-guide' as const, id: 'measurement-guide-1' }],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 10, minY: 10, maxX: 60, maxY: 10 },
      sameSpeciesReferenceCanonicalName: null,
    }
    controller.refreshMeasurements()
    expect(container.querySelector('[data-selection-action-command="save-object-stamp"]')).toBeNull()

    controller.dispose()
  })

  it('shows Group for mixed concrete selections and dispatches through the command surface', () => {
    const groupSelected = vi.fn()
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => ({
        editableTargets: [
          { kind: 'plant' as const, id: 'plant-1' },
          { kind: 'zone' as const, id: 'zone-1' },
        ],
        blockedTargets: [],
        bounds: { minX: 10, minY: 10, maxX: 40, maxY: 40 },
        sameSpeciesReferenceCanonicalName: null,
      }),
      selectionCommands: {
        duplicateSelected: vi.fn(),
        deleteSelected: vi.fn(),
        bringToFront: vi.fn(),
        sendToBack: vi.fn(),
        selectSameSpecies: vi.fn(),
        lockSelected: vi.fn(),
        unlockSelected: vi.fn(),
        groupSelected,
        ungroupSelected: vi.fn(),
      },
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()

    const group = container.querySelector<HTMLButtonElement>('[data-selection-action-command="group"]')
    expect(group).not.toBeNull()
    expect(container.querySelector('[data-selection-action-command="ungroup"]')).toBeNull()
    expect(group?.getAttribute('aria-label')).toContain('Group')
    expect(group?.querySelector('[data-selection-action-tooltip]')?.textContent).toContain('Group')

    group?.click()

    expect(groupSelected).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('does not expose Object Group actions for Measurement Guide selections', () => {
    let selectionModel: CanvasDesignObjectSelectionModel = {
      editableTargets: [
        { kind: 'plant' as const, id: 'plant-1' },
        { kind: 'measurement-guide' as const, id: 'measurement-guide-1' },
      ],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 10, minY: 10, maxX: 60, maxY: 40 },
      sameSpeciesReferenceCanonicalName: null,
    }
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => selectionModel,
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()

    expect(container.querySelector('[data-selection-action-command="group"]')).toBeNull()
    expect(container.querySelector('[data-selection-action-command="ungroup"]')).toBeNull()

    selectionModel = {
      editableTargets: [
        { kind: 'plant' as const, id: 'plant-1' },
        { kind: 'zone' as const, id: 'zone-1' },
        { kind: 'measurement-guide' as const, id: 'measurement-guide-1' },
      ],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 10, minY: 10, maxX: 60, maxY: 40 },
      sameSpeciesReferenceCanonicalName: null,
    }
    controller.refreshMeasurements()

    expect(container.querySelector('[data-selection-action-command="group"]')).toBeNull()
    controller.dispose()
  })

  it('shows Select Same Species only for one clear plant Species selection', () => {
    const selectSameSpecies = vi.fn()
    let selectionModel: CanvasDesignObjectSelectionModel = {
      editableTargets: [
        { kind: 'plant' as const, id: 'apple-1' },
        { kind: 'plant' as const, id: 'apple-2' },
      ],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 10, minY: 10, maxX: 60, maxY: 40 },
      sameSpeciesReferenceCanonicalName: 'Malus domestica',
    }
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => selectionModel,
      selectionCommands: {
        duplicateSelected: vi.fn(),
        deleteSelected: vi.fn(),
        bringToFront: vi.fn(),
        sendToBack: vi.fn(),
        selectSameSpecies,
        lockSelected: vi.fn(),
        unlockSelected: vi.fn(),
        groupSelected: vi.fn(),
        ungroupSelected: vi.fn(),
      },
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()

    const selectSame = container.querySelector<HTMLButtonElement>('[data-selection-action-command="select-same-species"]')
    expect(selectSame).not.toBeNull()
    expect(selectSame?.getAttribute('aria-label')).toContain('Select same species')
    selectSame?.click()
    expect(selectSameSpecies).toHaveBeenCalledTimes(1)

    selectionModel = {
      editableTargets: [
        { kind: 'plant' as const, id: 'apple-1' },
        { kind: 'zone' as const, id: 'zone-1' },
      ],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 10, minY: 10, maxX: 60, maxY: 40 },
      sameSpeciesReferenceCanonicalName: null,
    }
    controller.refreshMeasurements()

    expect(container.querySelector('[data-selection-action-command="select-same-species"]')).toBeNull()
    controller.dispose()
  })

  it('filters Group and Ungroup actions by selection eligibility', () => {
    const groupSelected = vi.fn()
    const ungroupSelected = vi.fn()
    let selectionModel: CanvasDesignObjectSelectionModel = {
      editableTargets: [
        { kind: 'plant' as const, id: 'plant-1' },
        { kind: 'zone' as const, id: 'zone-1' },
      ],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 10, minY: 10, maxX: 40, maxY: 40 },
      sameSpeciesReferenceCanonicalName: null,
    }
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => selectionModel,
      selectionCommands: {
        duplicateSelected: vi.fn(),
        deleteSelected: vi.fn(),
        bringToFront: vi.fn(),
        sendToBack: vi.fn(),
        selectSameSpecies: vi.fn(),
        lockSelected: vi.fn(),
        unlockSelected: vi.fn(),
        groupSelected,
        ungroupSelected,
      },
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()
    const mixedGroup = container.querySelector<HTMLButtonElement>('[data-selection-action-command="group"]')
    expect(mixedGroup).not.toBeNull()
    expect(container.querySelector('[data-selection-action-command="ungroup"]')).toBeNull()
    mixedGroup?.click()
    expect(groupSelected).toHaveBeenCalledTimes(1)

    selectionModel = {
      editableTargets: [
        { kind: 'plant' as const, id: 'plant-1' },
        { kind: 'plant' as const, id: 'plant-2' },
      ],
      lockedTargets: [],
      blockedTargets: [{
        target: { kind: 'missing' as const, id: 'missing-object' },
        reason: 'missing-design-object' as const,
        layerName: null,
      }],
      bounds: { minX: 10, minY: 10, maxX: 40, maxY: 40 },
      sameSpeciesReferenceCanonicalName: null,
    }
    controller.refreshMeasurements()
    expect(container.querySelector('[data-selection-action-command="group"]')).toBeNull()
    expect(container.querySelector('[data-selection-action-command="ungroup"]')).toBeNull()

    selectionModel = {
      editableTargets: [
        { kind: 'group' as const, id: 'group-1' },
        { kind: 'annotation' as const, id: 'annotation-1' },
      ],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 10, minY: 10, maxX: 40, maxY: 40 },
      sameSpeciesReferenceCanonicalName: null,
    }
    controller.refreshMeasurements()
    const regroup = container.querySelector<HTMLButtonElement>('[data-selection-action-command="group"]')
    expect(regroup).not.toBeNull()
    expect(container.querySelector('[data-selection-action-command="ungroup"]')).not.toBeNull()
    regroup?.click()
    expect(groupSelected).toHaveBeenCalledTimes(2)

    selectionModel = {
      editableTargets: [{ kind: 'group' as const, id: 'group-1' }],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 10, minY: 10, maxX: 40, maxY: 40 },
      sameSpeciesReferenceCanonicalName: null,
    }
    controller.refreshMeasurements()

    expect(container.querySelector('[data-selection-action-command="group"]')).toBeNull()
    const ungroup = container.querySelector<HTMLButtonElement>('[data-selection-action-command="ungroup"]')
    expect(ungroup).not.toBeNull()
    expect(ungroup?.getAttribute('aria-label')).toContain('Ungroup')

    ungroup?.click()

    expect(ungroupSelected).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('shows Lock for editable selections and dispatches through the command surface', () => {
    const lockSelected = vi.fn()
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'zone' as const, id: 'zone-1' }],
        blockedTargets: [],
        bounds: { minX: 160, minY: 100, maxX: 220, maxY: 150 },
        sameSpeciesReferenceCanonicalName: null,
      }),
      selectionCommands: {
        duplicateSelected: vi.fn(),
        deleteSelected: vi.fn(),
        bringToFront: vi.fn(),
        sendToBack: vi.fn(),
        selectSameSpecies: vi.fn(),
        lockSelected,
        unlockSelected: vi.fn(),
        groupSelected: vi.fn(),
        ungroupSelected: vi.fn(),
      },
    }
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()

    const lock = container.querySelector<HTMLButtonElement>('[data-selection-action-command="lock"]')
    expect(lock).not.toBeNull()
    expect(lock?.getAttribute('aria-label')).toContain('Lock')
    lock?.click()

    expect(lockSelected).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('shows a Rotation Handle for one eligible rotatable selection but not for a Placed Plant', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 40 },
        { x: 120, y: 40 },
        { x: 120, y: 100 },
        { x: 20, y: 100 },
      ])]
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 180, y: 90 })]
      draft.measurementGuides = [
        makeMeasurementGuide('measurement-guide-1', { x: 20, y: 140 }, { x: 120, y: 140 }),
      ]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)

    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')
    expect(handle).not.toBeNull()
    expect(handle?.style.display).toBe('inline-flex')

    deps.setSelection(['plant-1'])
    controller.refreshMeasurements()

    expect(handle?.style.display).toBe('none')

    deps.setSelection(['measurement-guide-1'])
    controller.refreshMeasurements()

    expect(handle?.style.display).toBe('none')

    deps.setSelection(['plant-1', 'measurement-guide-1'])
    controller.refreshMeasurements()

    expect(handle?.style.display).toBe('none')
    controller.dispose()
  })

  it('shows a Rotation Handle for one selected text annotation', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [{
        kind: 'annotation',
        id: 'annotation-1',
        locked: false,
        annotationType: 'text',
        position: { x: 80, y: 90 },
        text: 'Label',
        fontSize: 20,
        rotationDeg: null,
      }]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)

    deps.setSelection(['annotation-1'])
    controller.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')
    expect(handle).not.toBeNull()
    expect(handle?.style.display).toBe('inline-flex')
    controller.dispose()
  })

  it('drags the Rotation Handle to rotate a selected Zone with live readout and one Scene Edit', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 128, y: 110 }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)
    expect(container.querySelector<HTMLElement>('[data-rotation-handle-readout]')?.textContent).toBe('+90°')

    events.pointerUp({ x: 128, y: 110 }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    controller.dispose()
  })

  it('snaps Rotation Handle drags to 15 degree increments while Shift is held', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 82, y: 53 }, { button: 0, shiftKey: true })

    expect(store.persisted.zones[0]?.rotationDeg).toBe(15)
    expect(container.querySelector<HTMLElement>('[data-rotation-handle-readout]')?.textContent).toBe('+15°')
    controller.dispose()
  })

  it('aborts an active Rotation Handle drag on Escape without creating history', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 128, y: 110 }, { button: 0 })
    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)

    events.keyDown({ key: 'Escape', code: 'Escape' })
    events.pointerUp({ x: 128, y: 110 }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBe(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLElement>('[data-rotation-handle-readout]')?.style.display).toBe('none')
    controller.dispose()
  })

  it('commits a Rotation Handle drag on pointer-up outside the canvas', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 128, y: 110 }, { button: 0 })
    events.pointerUp({ x: 500, y: 110 }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    controller.dispose()
  })

  it('aborts tiny Rotation Handle deltas without dirtying history', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['zone-1'])
    controller.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: start.x + 0.1, y: start.y }, { button: 0 })
    events.pointerUp({ x: start.x + 0.1, y: start.y }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBe(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('hides the Rotation Handle for locked Design Objects, hidden Layers, and locked Layers', () => {
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['zone-1'])

    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ], { locked: true })]
    })
    controller.refreshMeasurements()
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')
    expect(handle?.style.display).toBe('none')

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, visible: false, locked: false } : layer
      ))
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    controller.refreshMeasurements()
    expect(handle?.style.display).toBe('none')

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, visible: true, locked: true } : layer
      ))
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    controller.refreshMeasurements()
    expect(handle?.style.display).toBe('none')
    controller.dispose()
  })

  it('rotates multi-plant selections around one shared Rotation Pivot without plant orientation', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 60, y: 120 }),
        makePlant('plant-2', 'Pyrus communis', { x: 90, y: 120 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['plant-1', 'plant-2'])
    controller.refreshMeasurements()
    const selection = getDesignObjectSelectionFromStore(store, camera)
    const pivot = selectionBoundsCenter(selection)
    const start = rotationHandleCenter(container)
    const end = quarterTurnClockwise(pivot, start)

    events.pointerDown(start, {
      button: 0,
      target: container.querySelector<HTMLElement>('[data-rotation-handle]')!,
    })
    events.pointerMove(end, { button: 0 })
    events.pointerUp(end, { button: 0 })

    expectPointCloseTo(store.persisted.plants[0]?.position, quarterTurnClockwise(pivot, { x: 60, y: 120 }))
    expectPointCloseTo(store.persisted.plants[1]?.position, quarterTurnClockwise(pivot, { x: 90, y: 120 }))
    expect(store.persisted.plants[0]?.rotationDeg).toBeNull()
    expect(store.persisted.plants[1]?.rotationDeg).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    controller.dispose()
  })

  it('rotates mixed selections through one Rotation Handle transaction', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 60, y: 120 })]
      draft.zones = [
        makeRectZone('line-1', [
          { x: 90, y: 120 },
          { x: 110, y: 120 },
        ], { zoneType: 'line' }),
        makeRectZone('rect-1', [
          { x: 130, y: 110 },
          { x: 150, y: 110 },
          { x: 150, y: 130 },
          { x: 130, y: 130 },
        ]),
      ]
      draft.annotations = [{
        kind: 'annotation',
        id: 'annotation-1',
        locked: false,
        annotationType: 'text',
        position: { x: 170, y: 120 },
        text: 'A',
        fontSize: 20,
        rotationDeg: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['plant-1', 'line-1', 'rect-1', 'annotation-1'])
    controller.refreshMeasurements()
    const selection = getDesignObjectSelectionFromStore(store, camera)
    const pivot = selectionBoundsCenter(selection)
    const start = rotationHandleCenter(container)
    const end = quarterTurnClockwise(pivot, start)

    events.pointerDown(start, {
      button: 0,
      target: container.querySelector<HTMLElement>('[data-rotation-handle]')!,
    })
    events.pointerMove(end, { button: 0 })
    events.pointerUp(end, { button: 0 })

    const line = store.persisted.zones.find((zone) => zone.name === 'line-1')
    const rect = store.persisted.zones.find((zone) => zone.name === 'rect-1')
    expectPointCloseTo(store.persisted.plants[0]?.position, quarterTurnClockwise(pivot, { x: 60, y: 120 }))
    expectPointCloseTo(line?.points[0], quarterTurnClockwise(pivot, { x: 90, y: 120 }))
    expectPointCloseTo(line?.points[1], quarterTurnClockwise(pivot, { x: 110, y: 120 }))
    expectPointCloseTo(pointsCenter(rect?.points ?? []), quarterTurnClockwise(pivot, { x: 140, y: 120 }))
    expect(rect?.rotationDeg).toBeCloseTo(90)
    expectPointCloseTo(store.persisted.annotations[0]?.position, quarterTurnClockwise(pivot, { x: 170, y: 120 }))
    expect(store.persisted.annotations[0]?.rotationDeg).toBeCloseTo(90)
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    controller.dispose()
  })

  it('rotates Object Groups by mutating member geometry instead of group rotation', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 60, y: 120 })]
      draft.zones = [makeRectZone('line-1', [
        { x: 90, y: 120 },
        { x: 110, y: 120 },
      ], { zoneType: 'line' })]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: 'Group',
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'line-1' },
        ],
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    deps.setSelection(['group-1'])
    controller.refreshMeasurements()
    const selection = getDesignObjectSelectionFromStore(store, camera)
    const pivot = selectionBoundsCenter(selection)
    const start = rotationHandleCenter(container)
    const end = quarterTurnClockwise(pivot, start)

    events.pointerDown(start, {
      button: 0,
      target: container.querySelector<HTMLElement>('[data-rotation-handle]')!,
    })
    events.pointerMove(end, { button: 0 })
    events.pointerUp(end, { button: 0 })

    const line = store.persisted.zones.find((zone) => zone.name === 'line-1')
    const group = store.persisted.groups[0]
    expectPointCloseTo(store.persisted.plants[0]?.position, quarterTurnClockwise(pivot, { x: 60, y: 120 }))
    expectPointCloseTo(line?.points[0], quarterTurnClockwise(pivot, { x: 90, y: 120 }))
    expectPointCloseTo(line?.points[1], quarterTurnClockwise(pivot, { x: 110, y: 120 }))
    expect(group?.members).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'line-1' },
    ])
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    controller.dispose()
  })

  it('hides the Rotation Handle for Object Groups that contain locked members', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 60, y: 120 }, { locked: true })]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: 'Group',
        members: [{ kind: 'plant', id: 'plant-1' }],
      }]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)

    deps.setSelection(['group-1'])
    controller.refreshMeasurements()

    expect(container.querySelector<HTMLElement>('[data-rotation-handle]')?.style.display).toBe('none')
    controller.dispose()
  })

  it('shows a direct unlock affordance when hovering a locked Design Object', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'locked-plant',
        locked: true,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerMove({ x: 20, y: 30 })

    const affordance = container.querySelector<HTMLElement>('[data-locked-object-affordance]')
    expect(affordance).not.toBeNull()
    expect(affordance?.dataset.lockedObjectId).toBe('locked-plant')
    const unlock = affordance?.querySelector<HTMLButtonElement>('[data-locked-object-unlock]')
    expect(unlock?.getAttribute('aria-label')).toContain('Unlock')
    expect(selectedObjectIds.value).toEqual(new Set())

    unlock?.click()

    expect(store.persisted.plants[0]?.locked).toBe(false)
    expect(onSceneEditCommit).toHaveBeenCalledWith('unlock-design-object')
    expect(selectedObjectIds.value).toEqual(new Set())
    controller.dispose()
  })

  it('does not show direct unlock affordances for Design Objects blocked by locked Layers', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'plants' ? { ...layer, locked: true } : layer
      ))
      draft.plants = [{
        kind: 'plant',
        id: 'locked-layer-plant',
        locked: true,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerMove({ x: 20, y: 30 })

    const affordance = container.querySelector<HTMLElement>('[data-locked-object-affordance]')
    expect(affordance).not.toBeNull()
    expect(affordance?.style.display).toBe('none')
    expect(affordance?.dataset.lockedObjectId).toBeUndefined()
    expect(selectedObjectIds.value).toEqual(new Set())
    controller.dispose()
  })

  it('suppresses native context menus only on canvas interaction surfaces', () => {
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'zone' as const, id: 'zone-1' }],
        blockedTargets: [],
        bounds: { minX: 160, minY: 100, maxX: 220, maxY: 150 },
      }),
    }
    const controller = new SceneInteractionController(deps as any)
    controller.refreshMeasurements()

    const canvasContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    container.dispatchEvent(canvasContext)
    expect(canvasContext.defaultPrevented).toBe(true)

    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')!
    const toolbarContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    toolbar.dispatchEvent(toolbarContext)
    expect(toolbarContext.defaultPrevented).toBe(true)

    const canvasInput = document.createElement('input')
    container.appendChild(canvasInput)
    const inputContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    canvasInput.dispatchEvent(inputContext)
    expect(inputContext.defaultPrevented).toBe(false)

    const canvasMenu = document.createElement('div')
    canvasMenu.setAttribute('role', 'menu')
    container.appendChild(canvasMenu)
    const menuContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    canvasMenu.dispatchEvent(menuContext)
    expect(menuContext.defaultPrevented).toBe(false)

    const canvasDialog = document.createElement('dialog')
    container.appendChild(canvasDialog)
    const dialogContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    canvasDialog.dispatchEvent(dialogContext)
    expect(dialogContext.defaultPrevented).toBe(false)

    const outsidePanel = document.createElement('div')
    document.body.appendChild(outsidePanel)
    const outsideContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    outsidePanel.dispatchEvent(outsideContext)
    expect(outsideContext.defaultPrevented).toBe(false)

    controller.dispose()
    outsidePanel.remove()
  })

  it('opens a Canvas Context Menu with disabled edit commands on empty canvas', () => {
    const controller = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
    const point = events.clientPoint({ x: 320, y: 260 })

    const canvasContext = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    })
    container.dispatchEvent(canvasContext)

    expect(canvasContext.defaultPrevented).toBe(true)
    const menu = container.querySelector<HTMLElement>('[data-canvas-context-menu]')
    expect(menu).not.toBeNull()
    expect(menu?.getAttribute('role')).toBe('menu')
    const copy = menu?.querySelector<HTMLButtonElement>('[data-canvas-context-command="copy"]')
    const paste = menu?.querySelector<HTMLButtonElement>('[data-canvas-context-command="paste"]')
    const remove = menu?.querySelector<HTMLButtonElement>('[data-canvas-context-command="delete"]')
    expect(copy?.textContent).toBe('Copy')
    expect(paste?.textContent).toBe('Paste')
    expect(remove?.textContent).toBe('Delete')
    expect(copy?.disabled).toBe(true)
    expect(paste?.disabled).toBe(true)
    expect(remove?.disabled).toBe(true)

    controller.dispose()
  })

  it('keeps the Canvas Context Menu visible inside the canvas edge', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    const controller = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
    const point = events.clientPoint({ x: 396, y: 296 })

    container.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    }))

    const menu = container.querySelector<HTMLElement>('[data-canvas-context-menu]')!
    expect(menu.style.display).toBe('block')
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(244)
    expect(Number.parseFloat(menu.style.top)).toBeLessThanOrEqual(200)
    expect(Number.parseInt(menu.style.zIndex, 10)).toBeGreaterThan(28)

    controller.dispose()
  })

  it('dispatches Canvas Context Menu edit commands through the scene edit surface', () => {
    const copy = vi.fn()
    const pasteAt = vi.fn()
    const deleteSelected = vi.fn()
    const baseDeps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'plant' as const, id: 'plant-1' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 20, minY: 20, maxX: 24, maxY: 24 },
        sameSpeciesReferenceCanonicalName: 'Malus domestica',
      }),
    })
    const deps = {
      ...baseDeps,
      selectionCommands: {
        ...baseDeps.selectionCommands,
        copy,
        pasteAt,
        canPaste: vi.fn(() => true),
        deleteSelected,
      },
    }
    const controller = new SceneInteractionController(deps as any)

    const openMenu = () => {
      const point = events.clientPoint({ x: 80, y: 90 })
      container.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }))
      return container.querySelector<HTMLElement>('[data-canvas-context-menu]')!
    }

    let menu = openMenu()
    const copyButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="copy"]')!
    expect(copyButton.disabled).toBe(false)
    copyButton.click()
    expect(copy).toHaveBeenCalledTimes(1)
    expect(menu.style.display).toBe('none')

    menu = openMenu()
    const pasteButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="paste"]')!
    expect(pasteButton.disabled).toBe(false)
    pasteButton.click()
    expect(pasteAt).toHaveBeenCalledWith({ x: 80, y: 90 })

    menu = openMenu()
    const deleteButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="delete"]')!
    expect(deleteButton.disabled).toBe(false)
    deleteButton.click()
    expect(deleteSelected).toHaveBeenCalledTimes(1)

    controller.dispose()
  })

  it('dispatches Canvas Context Menu Save as Saved Object Stamp and disables it for structural blockers', () => {
    const saveSelectionAsObjectStamp = vi.fn()
    let selectionModel: CanvasDesignObjectSelectionModel = {
      editableTargets: [{ kind: 'plant' as const, id: 'plant-1' }],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 20, minY: 20, maxX: 24, maxY: 24 },
      sameSpeciesReferenceCanonicalName: null,
    }
    const baseDeps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => selectionModel,
    })
    const deps = {
      ...baseDeps,
      contextualCommands: {
        saveSelectionAsObjectStamp,
      },
    }
    const controller = new SceneInteractionController(deps as any)

    const openMenu = () => {
      const point = events.clientPoint({ x: 80, y: 90 })
      container.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }))
      return container.querySelector<HTMLElement>('[data-canvas-context-menu]')!
    }

    let menu = openMenu()
    const saveButton = menu.querySelector<HTMLButtonElement>(
      '[data-canvas-context-command="save-object-stamp"]',
    )!
    expect(saveButton).not.toBeNull()
    expect(saveButton.textContent).toBe('Save as Saved Stamp')
    expect(saveButton.disabled).toBe(false)
    saveButton.click()
    expect(saveSelectionAsObjectStamp).toHaveBeenCalledTimes(1)

    selectionModel = {
      editableTargets: [{ kind: 'plant' as const, id: 'editable-plant' }],
      lockedTargets: [],
      blockedTargets: [{
        target: { kind: 'plant' as const, id: 'grouped-plant' },
        reason: 'grouped-member' as const,
        layerName: 'plants',
        groupId: 'group-1',
      }],
      bounds: { minX: 20, minY: 20, maxX: 60, maxY: 24 },
      sameSpeciesReferenceCanonicalName: null,
    }
    menu = openMenu()
    const blockedSaveButton = menu.querySelector<HTMLButtonElement>(
      '[data-canvas-context-command="save-object-stamp"]',
    )!
    expect(blockedSaveButton.disabled).toBe(true)
    blockedSaveButton.click()
    expect(saveSelectionAsObjectStamp).toHaveBeenCalledTimes(1)

    controller.dispose()
  })

  it('keeps Canvas Context Menu Copy and Delete disabled for mixed editable and locked selections', () => {
    const copy = vi.fn()
    const pasteAt = vi.fn()
    const deleteSelected = vi.fn()
    const baseDeps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'plant' as const, id: 'editable-plant' }],
        lockedTargets: [{ kind: 'plant' as const, id: 'locked-plant' }],
        blockedTargets: [{
          target: { kind: 'plant' as const, id: 'locked-plant' },
          reason: 'locked-design-object' as const,
          layerName: 'plants',
        }],
        bounds: { minX: 20, minY: 20, maxX: 60, maxY: 24 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    })
    const deps = {
      ...baseDeps,
      selectionCommands: {
        ...baseDeps.selectionCommands,
        copy,
        pasteAt,
        canPaste: vi.fn(() => true),
        deleteSelected,
      },
    }
    const controller = new SceneInteractionController(deps as any)
    const point = events.clientPoint({ x: 80, y: 90 })

    container.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    }))

    const menu = container.querySelector<HTMLElement>('[data-canvas-context-menu]')!
    const copyButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="copy"]')!
    const pasteButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="paste"]')!
    const deleteButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="delete"]')!

    expect(copyButton.disabled).toBe(true)
    expect(pasteButton.disabled).toBe(false)
    expect(deleteButton.disabled).toBe(true)

    copyButton.click()
    deleteButton.click()

    expect(copy).not.toHaveBeenCalled()
    expect(deleteSelected).not.toHaveBeenCalled()

    controller.dispose()
  })

  it('keeps Canvas Context Menu Copy and Delete disabled for mixed editable and structurally blocked selections', () => {
    const baseDeps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'plant' as const, id: 'editable-plant' }],
        lockedTargets: [],
        blockedTargets: [{
          target: { kind: 'plant' as const, id: 'grouped-plant' },
          reason: 'grouped-member' as const,
          layerName: 'plants',
          groupId: 'group-1',
        }],
        bounds: { minX: 20, minY: 20, maxX: 60, maxY: 24 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    })
    const deps = {
      ...baseDeps,
      selectionCommands: {
        ...baseDeps.selectionCommands,
        canPaste: vi.fn(() => true),
      },
    }
    const controller = new SceneInteractionController(deps as any)
    const point = events.clientPoint({ x: 80, y: 90 })

    container.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    }))

    const menu = container.querySelector<HTMLElement>('[data-canvas-context-menu]')!
    expect(menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="copy"]')?.disabled).toBe(true)
    expect(menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="paste"]')?.disabled).toBe(false)
    expect(menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="delete"]')?.disabled).toBe(true)

    controller.dispose()
  })

  it('disables Canvas Context Menu edits when a blocked hit would otherwise preserve another selection', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 }),
      ]
      draft.zones = [
        makeRectZone('locked-zone', [
          { x: 110, y: 20 },
          { x: 130, y: 20 },
          { x: 130, y: 40 },
          { x: 110, y: 40 },
        ]),
      ]
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'zones' ? { ...layer, locked: true } : layer,
      )
    })
    const copy = vi.fn()
    const pasteAt = vi.fn()
    const deleteSelected = vi.fn()
    const baseDeps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const deps = {
      ...baseDeps,
      selectionCommands: {
        ...baseDeps.selectionCommands,
        copy,
        pasteAt,
        canPaste: vi.fn(() => true),
        deleteSelected,
      },
    }
    const controller = new SceneInteractionController(deps as any)

    deps.setSelection(['plant-1'])
    vi.mocked(deps.setSelection).mockClear()
    const point = events.clientPoint({ x: 110, y: 30 })
    container.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    }))

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(deps.setSelection).not.toHaveBeenCalled()

    const menu = container.querySelector<HTMLElement>('[data-canvas-context-menu]')!
    const copyButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="copy"]')!
    const pasteButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="paste"]')!
    const deleteButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="delete"]')!

    expect(copyButton.disabled).toBe(true)
    expect(pasteButton.disabled).toBe(false)
    expect(deleteButton.disabled).toBe(true)

    copyButton.click()
    deleteButton.click()
    pasteButton.click()

    expect(copy).not.toHaveBeenCalled()
    expect(deleteSelected).not.toHaveBeenCalled()
    expect(pasteAt).toHaveBeenCalledWith({ x: 110, y: 30 })

    controller.dispose()
  })

  it('disables Canvas Context Menu edits for a topmost blocked hit over an editable target', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        makeRectZone('editable-zone', [
          { x: 110, y: 20 },
          { x: 130, y: 20 },
          { x: 130, y: 40 },
          { x: 110, y: 40 },
        ]),
      ]
      draft.plants = [
        makePlant('locked-layer-plant', 'Malus domestica', { x: 120, y: 30 }),
      ]
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'plants' ? { ...layer, locked: true } : layer,
      )
    })
    const copy = vi.fn()
    const pasteAt = vi.fn()
    const deleteSelected = vi.fn()
    const baseDeps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const deps = {
      ...baseDeps,
      selectionCommands: {
        ...baseDeps.selectionCommands,
        copy,
        pasteAt,
        canPaste: vi.fn(() => true),
        deleteSelected,
      },
    }
    const controller = new SceneInteractionController(deps as any)

    const point = events.clientPoint({ x: 120, y: 30 })
    container.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    }))

    expect(selectedObjectIds.value).toEqual(new Set())
    expect(deps.setSelection).not.toHaveBeenCalled()

    const menu = container.querySelector<HTMLElement>('[data-canvas-context-menu]')!
    const copyButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="copy"]')!
    const pasteButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="paste"]')!
    const deleteButton = menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="delete"]')!

    expect(copyButton.disabled).toBe(true)
    expect(pasteButton.disabled).toBe(false)
    expect(deleteButton.disabled).toBe(true)

    copyButton.click()
    deleteButton.click()
    pasteButton.click()

    expect(copy).not.toHaveBeenCalled()
    expect(deleteSelected).not.toHaveBeenCalled()
    expect(pasteAt).toHaveBeenCalledWith({ x: 120, y: 30 })

    controller.dispose()
  })

  it('updates Canvas Context Menu target selection like a design tool', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('plant-2', 'Pyrus communis', { x: 80, y: 30 }),
      ]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    deps.setSelection(['plant-1'])
    vi.mocked(deps.setSelection).mockClear()
    const plantTwoContext = events.clientPoint({ x: 80, y: 30 })
    container.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: plantTwoContext.x,
      clientY: plantTwoContext.y,
    }))

    expect(selectedObjectIds.value).toEqual(new Set(['plant-2']))
    expect(deps.setSelection).toHaveBeenCalledWith(new Set(['plant-2']))

    deps.setSelection(['plant-1', 'plant-2'])
    vi.mocked(deps.setSelection).mockClear()
    container.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: plantTwoContext.x,
      clientY: plantTwoContext.y,
    }))

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1', 'plant-2']))
    expect(deps.setSelection).not.toHaveBeenCalled()

    controller.dispose()
  })

  it('selects directly locked Canvas Context Menu targets with mutation commands disabled', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('locked-plant', 'Malus domestica', { x: 20, y: 30 }, { locked: true }),
      ]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    const point = events.clientPoint({ x: 20, y: 30 })

    container.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    }))

    expect(selectedObjectIds.value).toEqual(new Set(['locked-plant']))
    const menu = container.querySelector<HTMLElement>('[data-canvas-context-menu]')!
    expect(menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="copy"]')?.disabled).toBe(true)
    expect(menu.querySelector<HTMLButtonElement>('[data-canvas-context-command="delete"]')?.disabled).toBe(true)

    controller.dispose()
  })

  it('selects locked Design Objects for toolbar unlock without allowing drag mutations', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'locked-plant',
        locked: true,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const baseDeps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const unlockSelected = vi.fn(() => {
      baseDeps.sceneEdits.run('unlock-selected', (tx) => {
        tx.mutate((draft) => {
          const plant = draft.plants.find((entry) => entry.id === 'locked-plant')
          if (plant) plant.locked = false
        })
      })
    })
    const deps = {
      ...baseDeps,
      selectionCommands: {
        ...baseDeps.selectionCommands,
        unlockSelected,
      },
    }
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 35, y: 45 }, { button: 0 })
    events.pointerUp({ x: 35, y: 45 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['locked-plant']))
    expect(store.persisted.plants[0]?.position).toEqual({ x: 20, y: 30 })

    const toolbar = container.querySelector<HTMLElement>('[data-selection-action-toolbar]')
    expect(toolbar?.style.display).toBe('flex')
    expect(toolbar?.querySelector<HTMLButtonElement>('[data-selection-action-command="duplicate"]')?.disabled).toBe(true)
    expect(toolbar?.querySelector<HTMLButtonElement>('[data-selection-action-command="bring-forward"]')?.disabled).toBe(true)
    expect(toolbar?.querySelector<HTMLButtonElement>('[data-selection-action-command="send-backward"]')?.disabled).toBe(true)
    expect(toolbar?.querySelector<HTMLButtonElement>('[data-selection-action-command="delete"]')?.disabled).toBe(true)
    expect(toolbar?.querySelector('[data-selection-action-command="lock"]')).toBeNull()
    const unlock = toolbar?.querySelector<HTMLButtonElement>('[data-selection-action-command="unlock"]')
    expect(unlock?.disabled).toBe(false)
    expect(unlock?.getAttribute('aria-label')).toContain('Unlock')

    unlock?.click()
    controller.refreshMeasurements()

    expect(unlockSelected).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('unlock-selected')
    expect(store.persisted.plants[0]?.locked).toBe(false)
    expect(selectedObjectIds.value).toEqual(new Set(['locked-plant']))
    expect(container.querySelector('[data-selection-action-command="unlock"]')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('[data-selection-action-command="lock"]')?.disabled).toBe(false)
    expect(container.querySelector<HTMLButtonElement>('[data-selection-action-command="duplicate"]')?.disabled).toBe(false)
    controller.dispose()
  })

  it('drags only editable objects from a mixed locked and unlocked selection', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('editable-plant', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('locked-plant', 'Malus domestica', { x: 60, y: 30 }, { locked: true }),
      ]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0 })
    events.pointerDown({ x: 60, y: 30 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 60, y: 30 }, { button: 0, shiftKey: true })
    vi.mocked(deps.setSelection).mockClear()

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 35, y: 45 }, { button: 0 })
    events.pointerUp({ x: 35, y: 45 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['editable-plant', 'locked-plant']))
    expect(store.persisted.plants.find((plant) => plant.id === 'editable-plant')?.position).toEqual({ x: 35, y: 45 })
    expect(store.persisted.plants.find((plant) => plant.id === 'locked-plant')?.position).toEqual({ x: 60, y: 30 })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    expect(deps.setSelection).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('does not select groups that contain locked Design Object members', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'locked-member',
        locked: true,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: null,
        members: [{ kind: 'plant', id: 'locked-member' }],
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set())

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 30, y: 40 }, { button: 0 })
    events.pointerUp({ x: 30, y: 40 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set())
    controller.dispose()
  })

  it('shows Plant Spacing source picking and samples a plant without mutating selection', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'plant-1',
        locked: false,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    deps.setSelection(['already-selected'])
    vi.mocked(deps.setSelection).mockClear()
    const controller = new SceneInteractionController(deps as any)

    controller.setTool('plant-spacing')

    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')
    expect(hud?.textContent).toContain('Select a placed plant')
    expect(hud?.textContent).toContain('Esc to exit')
    expect(hud?.textContent).not.toContain('Plant Spacing')
    expect(hud?.querySelector('button')).toBeNull()

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-primary]')?.textContent).toBe('Apple')
    expect(hud?.textContent).toContain('Apple')
    expect(hud?.textContent).toContain('Esc to cancel')
    expect(hud?.textContent).not.toContain('Source selected')
    expect(hud?.textContent).not.toContain('Plant Spacing')
    expect(hud?.querySelector('button')).toBeNull()
    expect(deps.setSelection).not.toHaveBeenCalled()
    expect(selectedObjectIds.value).toEqual(new Set(['already-selected']))
    controller.dispose()
  })

  it('places the Plant Spacing HUD in the top-left safe canvas slot', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)

    controller.setTool('plant-spacing')

    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')!
    const safeInset = CANVAS_RULER_SIZE_PX + CANVAS_NOTICE_MARGIN_PX
    expect(hud.style.left).toBe(`${safeInset}px`)
    expect(hud.style.top).toBe(`${safeInset}px`)
    controller.dispose()
  })

  it('compacts the Plant Spacing HUD on constrained canvas sizes', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 180 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 96 })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)

    controller.setTool('plant-spacing')

    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')!
    expect(hud.dataset.compact).toBe('true')
    expect(Number.parseFloat(hud.style.maxWidth)).toBeLessThan(240)
    expect(hud.textContent).toContain('Select a placed plant')
    controller.dispose()
  })

  it('keeps Plant Spacing in source-picking mode on missed clicks without clearing selection', () => {
    const deps = createInteractionDeps(container, store, camera)
    deps.setSelection(['already-selected'])
    vi.mocked(deps.setSelection).mockClear()
    vi.mocked(deps.clearSelection).mockClear()
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 200, y: 200 }, { button: 0 })

    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')
    expect(hud?.dataset.state).toBe('source-picking')
    expect(hud?.textContent).toContain('Select a visible, unlocked placed plant')
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(deps.clearSelection).not.toHaveBeenCalled()
    expect(deps.setSelection).not.toHaveBeenCalled()
    expect(selectedObjectIds.value).toEqual(new Set(['already-selected']))
    controller.dispose()
  })

  it('does not sample grouped or locked Plant Spacing source candidates', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        {
          kind: 'plant',
          id: 'grouped-plant',
          locked: false,
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: null,
          canopySpreadM: 2,
          position: { x: 20, y: 30 },
          rotationDeg: null,
          scale: 2,
          notes: null,
          plantedDate: null,
          quantity: 1,
        },
        {
          kind: 'plant',
          id: 'locked-plant',
          locked: true,
          canonicalName: 'Pyrus communis',
          commonName: 'Pear',
          color: null,
          stratum: null,
          canopySpreadM: 2,
          position: { x: 80, y: 30 },
          rotationDeg: null,
          scale: 2,
          notes: null,
          plantedDate: null,
          quantity: 1,
        },
      ]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: 'Grouped row',
        members: [{ kind: 'plant', id: 'grouped-plant' }],
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()

    events.pointerDown({ x: 80, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    controller.dispose()
  })

  it('does not sample Plant Spacing sources on hidden or locked plant layers', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'plants' ? { ...layer, visible: false, locked: false } : layer
      )
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'plants' ? { ...layer, visible: true, locked: true } : layer
      )
    })

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    controller.dispose()
  })

  it('clears Plant Spacing source state with Escape and exits when no source exists', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const setTool = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setTool })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()

    events.keyDown({ key: 'Escape' })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.dataset.state).toBe('source-picking')
    expect(setTool).not.toHaveBeenCalled()

    events.keyDown({ key: 'Escape' })
    expect(setTool).toHaveBeenCalledWith('select')
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.style.display).toBe('none')
    controller.dispose()
  })

  it('cleans up Plant Spacing source and preview when switching tools', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()

    controller.setTool('select')

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.style.display).toBe('none')
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-guide]')).toBeNull()
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(0)

    controller.setTool('plant-spacing')
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.dataset.state).toBe('source-picking')
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    controller.dispose()
  })

  it('removes Plant Spacing overlays on controller dispose', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-hud]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()

    controller.dispose()

    expect(container.querySelector('[data-plant-spacing-hud]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-guide]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-length-label]')).toBeNull()
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(0)
  })

  it('focuses Plant Spacing interval input after source sampling and accepts valid values with Enter', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)

    controller.setTool('plant-spacing')
    const inputBeforeSource = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')
    expect(document.activeElement).not.toBe(inputBeforeSource)

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')!
    expect(input.value).toBe('50 cm')
    expect(document.activeElement).toBe(input)

    input.value = '0,75m'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(hud.dataset.intervalValidity).toBe('valid')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(plantSpacingIntervalM.value).toBe(0.75)
    expect(document.activeElement).toBe(container)
    expect(store.persisted.plants).toHaveLength(1)
    expect(JSON.stringify(store.toCanopiFile())).not.toContain('plant_spacing_interval_m')
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    controller.dispose()
  })

  it('applies Plant Spacing interval blur without stealing focus from the next control', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const nextControl = document.createElement('button')
    document.body.appendChild(nextControl)
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    input.value = '0,75m'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    nextControl.focus()
    input.dispatchEvent(new FocusEvent('blur'))

    expect(plantSpacingIntervalM.value).toBe(0.75)
    expect(document.activeElement).toBe(nextControl)
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    controller.dispose()
    nextControl.remove()
  })

  it('keeps invalid Plant Spacing interval blur from stealing focus or mutating', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const nextControl = document.createElement('button')
    document.body.appendChild(nextControl)
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')!
    input.value = '0'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    nextControl.focus()
    input.dispatchEvent(new FocusEvent('blur'))

    expect(hud.dataset.intervalValidity).toBe('invalid')
    expect(plantSpacingIntervalM.value).toBe(0.5)
    expect(document.activeElement).toBe(nextControl)
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    controller.dispose()
    nextControl.remove()
  })

  it('handles Escape from the focused Plant Spacing interval input', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    expect(document.activeElement).toBe(input)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.dataset.state).toBe('source-picking')
    controller.dispose()
  })

  it('lets Plant Spacing interval input bubble global shortcut keys', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    const onWindowKeyDown = vi.fn()
    window.addEventListener('keydown', onWindowKeyDown)

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
    }))

    expect(onWindowKeyDown).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', onWindowKeyDown)
    controller.dispose()
  })

  it('ignores Plant Spacing HUD pointerdowns while editing the interval input', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    input.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 26,
      clientY: 30,
      button: 0,
    }))

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    controller.dispose()
  })

  it('ignores Plant Spacing HUD pointermoves while editing the interval input', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    const guide = container.querySelector<HTMLElement>('[data-plant-spacing-guide]')!
    const label = container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')!
    const initialGuideWidth = guide.style.width
    const initialLabel = label.textContent
    const initialGhostCount = container.querySelectorAll('[data-plant-spacing-ghost]').length

    input.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 120,
      clientY: 30,
      button: 0,
    }))

    expect(guide.style.width).toBe(initialGuideWidth)
    expect(label.textContent).toBe(initialLabel)
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(initialGhostCount)
    controller.dispose()
  })

  it('ignores Plant Spacing HUD pointerups during click-hold drag', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    input.dispatchEvent(new MouseEvent('pointerup', {
      bubbles: true,
      clientX: 120,
      clientY: 30,
      button: 0,
    }))

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    controller.dispose()
  })

  it('keeps Plant Spacing source alive for invalid interval input', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')!
    input.value = '0'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(hud.dataset.intervalValidity).toBe('invalid')
    expect(plantSpacingIntervalM.value).toBe(0.5)
    expect(document.activeElement).toBe(input)
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    controller.dispose()
  })

  it('previews and commits a normal Plant Spacing sequence as one scene edit', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#884422',
        stratum: 'tree',
        canopySpreadM: 3,
        position: { x: 20, y: 30 },
        rotationDeg: 15,
        scale: 3,
        notes: 'Do not copy',
        plantedDate: '2026-03-01',
        quantity: 4,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    events.pointerMove({ x: 26, y: 30 }, { button: 0 })

    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('6 m')
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(3)
    const ghost = container.querySelector<HTMLElement>('[data-plant-spacing-ghost]')!
    expect(Number.parseFloat(ghost.style.width)).toBeCloseTo(4.43, 2)
    expect(Number.parseFloat(ghost.style.height)).toBeCloseTo(4.43, 2)
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.textContent).toContain('3')

    events.pointerDown({ x: 26, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(4)
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 22, y: 30 },
      { x: 24, y: 30 },
      { x: 26, y: 30 },
    ])
    expect(store.persisted.plants[1]).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#884422',
      stratum: 'tree',
      canopySpreadM: 3,
      rotationDeg: 15,
      scale: 3,
      notes: null,
      plantedDate: null,
      quantity: 1,
    })
    expect(store.persisted.groups).toEqual([])
    expect(selectedObjectIds.value).toEqual(new Set(store.persisted.plants.map((plant) => plant.id)))
    expect(container.querySelector('[data-plant-spacing-guide]')).toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.dataset.state).toBe('source-picking')
    controller.dispose()
  })

  it('does not commit Plant Spacing when the sampled source becomes unavailable before commit', () => {
    const runBlockedCommit = (blockCommit: () => void, expectedPlantCount = 1): void => {
      store = new SceneStore()
      plantSpacingIntervalM.value = 2
      store.updatePersisted((draft) => {
        draft.plants = [{
          kind: 'plant',
          id: 'source',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: null,
          canopySpreadM: 2,
          position: { x: 20, y: 30 },
          rotationDeg: null,
          scale: 2,
          notes: null,
          plantedDate: null,
          quantity: 1,
          locked: false,
        }]
      })
      const onSceneEditCommit = vi.fn()
      const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
      const controller = new SceneInteractionController(deps as any)
      controller.setTool('plant-spacing')
      events.pointerDown({ x: 20, y: 30 }, { button: 0 })
      events.pointerMove({ x: 26, y: 30 }, { button: 0 })

      blockCommit()
      events.pointerDown({ x: 26, y: 30 }, { button: 0 })

      expect(onSceneEditCommit).not.toHaveBeenCalled()
      expect(store.persisted.plants).toHaveLength(expectedPlantCount)
      expect(container.querySelector('[data-plant-spacing-guide]')).toBeNull()
      expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
      expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.dataset.state).toBe('source-picking')
      expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.textContent).toContain('Select a visible, unlocked placed plant')
      controller.dispose()
    }

    runBlockedCommit(function lockSourcePlant() {
      store.updatePersisted((draft) => {
        draft.plants = draft.plants.map((plant) =>
          plant.id === 'source' ? { ...plant, locked: true } : plant,
        )
      })
    })
    runBlockedCommit(function removeSourcePlant() {
      store.updatePersisted((draft) => {
        draft.plants = []
      })
    }, 0)
    runBlockedCommit(function lockPlantsLayer() {
      store.updatePersisted((draft) => {
        draft.layers = draft.layers.map((layer) =>
          layer.name === 'plants' ? { ...layer, locked: true } : layer
        )
      })
    })
    runBlockedCommit(function hidePlantsLayer() {
      store.updatePersisted((draft) => {
        draft.layers = draft.layers.map((layer) =>
          layer.name === 'plants' ? { ...layer, visible: false } : layer
        )
      })
    })
  })

  it('caps dense Plant Spacing preview ghosts while keeping the generated count', () => {
    plantSpacingIntervalM.value = 0.001
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 22, y: 30 }, { button: 0 })

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.textContent).toContain('2000')
    const ghostCount = container.querySelectorAll('[data-plant-spacing-ghost]').length
    expect(ghostCount).toBeGreaterThan(0)
    expect(ghostCount).toBeLessThan(2000)
    controller.dispose()
  })

  it('blocks Plant Spacing commits above the hard safety cap without creating plants', () => {
    plantSpacingIntervalM.value = 0.001
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 20, y: 10 }, { button: 0 })

    const count = container.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')!
    expect(count.textContent).toContain('10000')
    expect(count.dataset.density).toBe('blocked')

    events.pointerDown({ x: 20, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.textContent).toContain(
      'Increase interval or shorten the line',
    )
    controller.dispose()
  })

  it('commits Plant Spacing at the hard safety cap without confirmation', () => {
    plantSpacingIntervalM.value = 0.001
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 15, y: 10 }, { button: 0 })

    const count = container.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')!
    expect(count.textContent).toContain('5000')
    expect(count.dataset.density).toBe('dense')
    expect(container.querySelector('[data-plant-spacing-confirm]')).toBeNull()

    events.pointerDown({ x: 15, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(5001)
    expect(store.persisted.plants[store.persisted.plants.length - 1]?.position).toEqual({ x: 15, y: 10 })
    controller.dispose()
  })

  it('sizes Plant Spacing preview ghosts from canopy plant presentation', () => {
    plantSpacingIntervalM.value = 2
    camera.setViewport({ x: 0, y: 0, scale: 10 })
    store.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 4,
        position: { x: 2, y: 3 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getPlantPresentationContext: (viewportScale) => ({
        ...createPlantPresentationContext(viewportScale),
        sizeMode: 'canopy',
      }),
    })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 60, y: 30 }, { button: 0 })

    const ghosts = container.querySelectorAll<HTMLElement>('[data-plant-spacing-ghost]')
    expect(ghosts).toHaveLength(2)
    expect(ghosts[0]?.style.width).toBe('40px')
    expect(ghosts[0]?.style.height).toBe('40px')

    events.wheel({ x: 0, y: 0 }, { deltaY: -120 })

    const resizedGhost = container.querySelector<HTMLElement>('[data-plant-spacing-ghost]')!
    expect(resizedGhost.style.width).not.toBe('40px')
    expect(resizedGhost.style.height).not.toBe('40px')
    controller.dispose()
  })

  it('keeps Plant Spacing preview active without a scene edit when no plants fit', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 21, y: 30 }, { button: 0 })

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('1 m')
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(0)

    events.pointerDown({ x: 21, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    controller.dispose()
  })

  it('formats a zero-length Plant Spacing guide as 0 cm while preserving the interval input fallback', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 20, y: 30 }, { button: 0 })

    expect(container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')?.value).toBe('50 cm')
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('0 cm')
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')?.textContent).toContain('0')
    controller.dispose()
  })

  it('snaps Plant Spacing endpoint before computing preview and commit positions', () => {
    plantSpacingIntervalM.value = 2
    snapToGridEnabled.value = true
    camera.setViewport({ x: 0, y: 0, scale: 10 })
    store.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 2, y: 4 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 40 }, { button: 0 })
    events.pointerMove({ x: 51, y: 40 }, { button: 0 })

    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(2)

    events.pointerDown({ x: 51, y: 40 }, { button: 0 })
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 4, y: 4 },
      { x: 6, y: 4 },
    ])
    controller.dispose()
  })

  it('gives Shift direction constraint priority over Plant Spacing snapping', () => {
    plantSpacingIntervalM.value = 1
    snapToGridEnabled.value = true
    camera.setViewport({ x: 0, y: 0, scale: 10 })
    store.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 4, y: 4 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 71, y: 52 }, { button: 0, shiftKey: true })

    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(3)

    events.pointerDown({ x: 71, y: 52 }, { button: 0, shiftKey: true })
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.y)).toEqual([4, 4, 4])
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.x)).toEqual([5, 6, 7])
    controller.dispose()
  })

  it('commits a Plant Spacing click-hold drag from the latest Shift-constrained preview endpoint', () => {
    plantSpacingIntervalM.value = 1
    camera.setViewport({ x: 0, y: 0, scale: 10 })
    store.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 4, y: 4 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 71, y: 52 }, { button: 0, shiftKey: true })

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-guide]')?.style.transform).toBe('rotate(0rad)')

    events.pointerUp({ x: 71, y: 52 }, { button: 0, shiftKey: false })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.y)).toEqual([4, 4, 4])
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.x)).toEqual([5, 6, 7])
    controller.dispose()
  })

  it('clamps Plant Spacing endpoints outside the canvas to the visible edge', () => {
    plantSpacingIntervalM.value = 100
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 500, y: 30 }, { button: 0 })

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('380 m')

    events.pointerDown({ x: 500, y: 30 }, { button: 0 })
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 120, y: 30 },
      { x: 220, y: 30 },
      { x: 320, y: 30 },
    ])
    controller.dispose()
  })

  it('refreshes Plant Spacing preview after viewport changes', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    const guide = container.querySelector<HTMLElement>('[data-plant-spacing-guide]')!
    const widthBefore = guide.style.width

    events.wheel({ x: 0, y: 0 }, { deltaY: -120 })

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('6 m')
    expect(guide.style.width).not.toBe(widthBefore)
    controller.dispose()
  })

  it('commits exactly 100 generated Plant Spacing plants without confirmation', () => {
    plantSpacingIntervalM.value = 1
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 110, y: 10 }, { button: 0 })
    events.pointerDown({ x: 110, y: 10 }, { button: 0 })

    expect(container.querySelector('[data-plant-spacing-confirm]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(101)
    controller.dispose()
  })

  it('emphasizes dense Plant Spacing counts and commits them directly', () => {
    plantSpacingIntervalM.value = 1
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 111, y: 10 }, { button: 0 })

    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')!
    const count = container.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')!
    expect(hud.textContent).toContain('101')
    expect(hud.textContent).not.toContain('Confirm')
    expect(container.querySelector('[data-plant-spacing-confirm]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-cancel-confirm]')).toBeNull()
    expect(count.dataset.density).toBe('dense')
    expect(count.style.color).toBe('var(--color-primary)')
    expect(count.style.fontWeight).toBe('600')

    events.pointerDown({ x: 111, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(102)
    expect(store.persisted.plants[store.persisted.plants.length - 1]?.position).toEqual({ x: 111, y: 10 })
    controller.dispose()
  })

  it('does not commit Plant Spacing from minor source-click pointer jitter', () => {
    plantSpacingIntervalM.value = 0.5
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 21, y: 30 }, { button: 0 })
    events.pointerUp({ x: 21, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    controller.dispose()
  })

  it('commits Plant Spacing from click-hold drag without focusing the interval input mid-drag', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    expect(document.activeElement).not.toBe(input)
    events.pointerUp({ x: 26, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(4)
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 22, y: 30 },
      { x: 24, y: 30 },
      { x: 26, y: 30 },
    ])
    controller.dispose()
  })

  it('commits Plant Spacing click-hold drag from the pointerup endpoint when release moves past the preview', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 25, y: 30 }, { button: 0 })
    events.pointerUp({ x: 26, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 22, y: 30 },
      { x: 24, y: 30 },
      { x: 26, y: 30 },
    ])
    controller.dispose()
  })

  it('commits dense Plant Spacing from click-hold drag directly', () => {
    plantSpacingIntervalM.value = 1
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 111, y: 10 }, { button: 0 })
    events.pointerUp({ x: 111, y: 10 }, { button: 0 })

    expect(container.querySelector('[data-plant-spacing-confirm]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(102)
    expect(store.persisted.plants[store.persisted.plants.length - 1]?.position).toEqual({ x: 111, y: 10 })
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.dataset.state).toBe('source-picking')
    controller.dispose()
  })

  it('keeps source and focuses interval input after click-hold Plant Spacing drag with invalid interval', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    input.value = '0'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    events.pointerUp({ x: 26, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    expect(document.activeElement).toBe(input)
    controller.dispose()
  })

  it('routes wheel zoom through the viewport setter and viewport render path', () => {
    const render = vi.fn()
    const setViewport = vi.fn((viewport) => {
      store.setViewport(viewport)
    })
    const deps = createInteractionDeps(container, store, camera, { render, setViewport })
    const controller = new SceneInteractionController(deps as any)

    const wheel = events.wheel({ x: 200, y: 150 }, { deltaY: -120 })

    expect(wheel.defaultPrevented).toBe(true)
    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledWith('viewport')
    controller.dispose()
  })

  it('commits a text Annotation with Enter and selects it', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Guild note'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(1)
    expect(store.persisted.annotations[0]).toMatchObject({
      annotationType: 'text',
      position: { x: 24, y: 32 },
      text: 'Guild note',
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-text')
    expect(deps.setSelection).toHaveBeenCalledWith([store.persisted.annotations[0]!.id])
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('does not create text Annotations on a locked Annotations Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })

    expect(container.querySelector('textarea')).toBeNull()
    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('cancels a pending text Annotation with Escape', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Draft note'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('commits a pending text Annotation on blur', async () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    await nextAnimationFrame()
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Blurred note'
    textarea.dispatchEvent(new FocusEvent('blur'))
    await nextAnimationFrame()

    expect(store.persisted.annotations).toHaveLength(1)
    expect(store.persisted.annotations[0]).toMatchObject({
      position: { x: 24, y: 32 },
      text: 'Blurred note',
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-text')
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('does not commit empty text Annotations', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = '   '
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('cleans up pending text Annotation editors on tool change and disposal', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    expect(container.querySelector('textarea')).not.toBeNull()
    controller.setTool('select')
    expect(container.querySelector('textarea')).toBeNull()

    controller.setTool('text')
    events.pointerDown({ x: 48, y: 64 }, { button: 0 })
    expect(container.querySelector('textarea')).not.toBeNull()
    controller.dispose()
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('keeps Space from starting canvas panning while a text Annotation editor is active', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    expect(container.querySelector('textarea')).not.toBeNull()
    expect(container.style.cursor).toBe('text')

    events.keyDown({
      key: ' ',
      code: 'Space',
      cancelable: true,
    })

    expect(container.style.cursor).toBe('text')
    controller.dispose()
  })

  it('edits an existing text Annotation in place after double-click and Enter', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Old note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    expect(textarea.value).toBe('Old note')

    textarea.value = 'Updated note'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations[0]).toMatchObject({
      id: 'annotation-1',
      text: 'Updated note',
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-annotation-text')
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('opens existing text Annotation editing from two primary clicks without pointer detail', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Portable note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 27, y: 35 }, { button: 0, detail: 1 })

    expect(selectedObjectIds.value).toEqual(new Set(['annotation-1']))
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Portable note')
    controller.dispose()
  })

  it('does not open existing text Annotation editing when the second click is additive or too far away', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Portable note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 27, y: 35 }, { button: 0, detail: 1, shiftKey: true })
    expect(container.querySelector('textarea')).toBeNull()

    events.pointerUp({ x: 27, y: 35 }, { button: 0, detail: 1, shiftKey: true })
    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 1 })
    expect(container.querySelector('textarea')).toBeNull()
    events.pointerUp({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 60, y: 70 }, { button: 0, detail: 1 })

    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('does not open existing text Annotation editing after an intervening empty click without pointer detail', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Portable note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 200, y: 200 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 200, y: 200 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 27, y: 35 }, { button: 0, detail: 1 })

    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('opens selected text Annotation editing from F2 and keeps Shift+Enter inside the editor', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Line one')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['annotation-1'])

    events.keyDown({ key: 'F2', cancelable: true, target: container })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    expect(textarea.value).toBe('Line one')

    textarea.value = 'Line one\nLine two'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    expect(container.querySelector('textarea')).toBe(textarea)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(store.persisted.annotations[0]?.text).toBe('Line one\nLine two')
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-annotation-text')
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('opens selected text Annotation editing from Enter when the canvas has keyboard focus', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Keyboard note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['annotation-1'])

    const event = events.keyDown({ key: 'Enter', cancelable: true, target: container })

    expect(event.defaultPrevented).toBe(true)
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keyboard note')
    controller.dispose()
  })

  it('does not intercept Annotation edit shortcuts from focused controls outside the canvas', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Keyboard note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['annotation-1'])
    const externalButton = document.createElement('button')
    document.body.appendChild(externalButton)
    externalButton.focus()

    const enterEvent = events.keyDown({ key: 'Enter', cancelable: true, target: externalButton })
    const f2Event = events.keyDown({ key: 'F2', cancelable: true, target: externalButton })

    expect(enterEvent.defaultPrevented).toBe(false)
    expect(f2Event.defaultPrevented).toBe(false)
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
    externalButton.remove()
  })

  it('cancels existing text Annotation edits with Escape without history', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Original note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Discard me'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(store.persisted.annotations[0]?.text).toBe('Original note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('does not create history when committing unchanged existing text Annotation text', async () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Stable note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.dispatchEvent(new FocusEvent('blur'))
    await nextAnimationFrame()

    expect(store.persisted.annotations[0]?.text).toBe('Stable note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('commits existing text Annotation edits when clicking away on the canvas', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Before click-away')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'After click-away'
    events.pointerDown({ x: 320, y: 240 }, { button: 0 })

    expect(store.persisted.annotations[0]?.text).toBe('After click-away')
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-annotation-text')
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('does not commit existing text Annotation edits after the Annotation becomes locked before blur commit', async () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Original note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Blocked edit'
    store.updatePersisted((draft) => {
      draft.annotations = draft.annotations.map((annotation) => (
        annotation.id === 'annotation-1' ? { ...annotation, locked: true } : annotation
      ))
    })
    textarea.dispatchEvent(new FocusEvent('blur'))
    await nextAnimationFrame()

    expect(store.persisted.annotations[0]?.text).toBe('Original note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('does not commit existing text Annotation edits after the Annotations Layer becomes locked', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Original note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Locked layer edit'
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, locked: true } : layer
      ))
    })
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations[0]?.text).toBe('Original note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('does not commit existing text Annotation edits after the Annotations Layer becomes hidden', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Original note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Hidden layer edit'
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, visible: false } : layer
      ))
    })
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations[0]?.text).toBe('Original note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('deletes an existing text Annotation when committed text is empty', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Delete me')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['annotation-1'])

    events.keyDown({ key: 'F2', cancelable: true, target: container })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = '   '
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-annotation-text')
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('does not delete an existing text Annotation after it becomes locked before empty commit', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Delete me')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')
    deps.setSelection(['annotation-1'])

    events.keyDown({ key: 'F2', cancelable: true, target: container })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = '   '
    store.updatePersisted((draft) => {
      draft.annotations = draft.annotations.map((annotation) => (
        annotation.id === 'annotation-1' ? { ...annotation, locked: true } : annotation
      ))
    })
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(1)
    expect(store.persisted.annotations[0]?.text).toBe('Delete me')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('does not edit locked, locked-Layer, hidden, or grouped text Annotations', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [
        makeTextAnnotation('locked-annotation', { x: 24, y: 32 }, 'Locked', { locked: true }),
        makeTextAnnotation('layer-blocked-annotation', { x: 80, y: 32 }, 'Layer blocked'),
        makeTextAnnotation('hidden-annotation', { x: 140, y: 32 }, 'Hidden'),
        makeTextAnnotation('grouped-annotation', { x: 200, y: 32 }, 'Grouped'),
      ]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: null,
        members: [
          { kind: 'annotation', id: 'grouped-annotation' },
          { kind: 'annotation', id: 'missing-partner' },
        ],
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    deps.setSelection(['locked-annotation'])
    events.keyDown({ key: 'F2', cancelable: true, target: container })
    expect(container.querySelector('textarea')).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, locked: true } : layer
      ))
    })
    events.pointerDown({ x: 82, y: 34 }, { button: 0, detail: 2 })
    expect(container.querySelector('textarea')).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, locked: false, visible: false } : layer
      ))
    })
    events.pointerDown({ x: 142, y: 34 }, { button: 0, detail: 2 })
    expect(container.querySelector('textarea')).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, visible: true } : layer
      ))
    })
    events.pointerDown({ x: 202, y: 34 }, { button: 0, detail: 2 })
    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('cleans up existing text Annotation editors on tool change and disposal', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Cleanup note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const firstTextarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    firstTextarea.value = 'Discard on tool change'
    controller.setTool('rectangle')
    expect(container.querySelector('textarea')).toBeNull()
    expect(store.persisted.annotations[0]?.text).toBe('Cleanup note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    controller.setTool('select')
    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const secondTextarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    secondTextarea.value = 'Discard on dispose'
    controller.dispose()

    expect(container.querySelector('textarea')).toBeNull()
    expect(store.persisted.annotations[0]?.text).toBe('Cleanup note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
  })

  it('cleans up existing text Annotation editors when the document no longer contains the Annotation', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Document note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    expect(container.querySelector('textarea')).not.toBeNull()

    store.updatePersisted((draft) => {
      draft.annotations = []
    })
    controller.refreshMeasurements()

    expect(container.querySelector('textarea')).toBeNull()
    controller.dispose()
  })

  it('creates a rectangle zone from the rectangle tool drag', () => {
    const render = vi.fn()
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render, onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('rectangle')

    events.pointerDown({ x: 10, y: 20 })
    events.pointerMove({ x: 40, y: 60 })
    events.pointerUp({ x: 40, y: 60 })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'rect',
      rotationDeg: 0,
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 60 },
        { x: 10, y: 60 },
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rectangle')
    expect(deps.setSelection).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('does not create rectangle zones on a locked Zones Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('rectangle')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 40, y: 60 }, { button: 0 })
    events.pointerUp({ x: 40, y: 60 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('creates a linear zone from the Line tool drag', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('line')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 40, y: 60 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('10px')
    expect(preview?.style.top).toBe('20px')
    expect(preview?.style.width).toBe('50px')

    events.pointerUp({ x: 40, y: 60 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'line',
      rotationDeg: 0,
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 60 },
      ],
    })
    expect(store.toCanopiFile().zones[0]).toMatchObject({
      zone_type: 'line',
      rotation: 0,
      locked: false,
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 60 },
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-line')
    expect(deps.setSelection).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('does not create linear zones on a locked Zones Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('line')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 40, y: 60 }, { button: 0 })
    events.pointerUp({ x: 40, y: 60 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('shows live linear zone length while drawing without persisting it', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('line')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 20 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual(['60 m'])
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('previews and commits linear zones from snap-adjusted grid points', () => {
    // At scale=4, gridInterval() returns 5m.
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('line')

    events.pointerDown({ x: 43, y: 87 }, { button: 0 })
    events.pointerMove({ x: 148, y: 254 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('40px')
    expect(preview?.style.top).toBe('80px')

    events.pointerUp({ x: 148, y: 254 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'line',
      rotationDeg: 0,
      points: [
        { x: 10, y: 20 },
        { x: 35, y: 65 },
      ],
    })
    controller.dispose()
  })

  it('does not commit too-short linear zones', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('line')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 10.2, y: 10.2 }, { button: 0 })
    events.pointerUp({ x: 10.2, y: 10.2 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('creates an elliptical zone from the ellipse tool drag', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('ellipse')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 100 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.borderRadius).toBe('50%')

    events.pointerUp({ x: 70, y: 100 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'ellipse',
      rotationDeg: 0,
      points: [
        { x: 40, y: 60 },
        { x: 30, y: 40 },
      ],
    })
    expect(store.toCanopiFile().zones[0]).toMatchObject({
      zone_type: 'ellipse',
      rotation: 0,
      locked: false,
      points: [
        { x: 40, y: 60 },
        { x: 30, y: 40 },
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-ellipse')
    expect(deps.setSelection).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('does not create elliptical zones on a locked Zones Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('ellipse')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 100 }, { button: 0 })
    events.pointerUp({ x: 70, y: 100 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('normalizes elliptical zone drags in any direction', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('ellipse')

    events.pointerDown({ x: 110, y: 90 }, { button: 0 })
    events.pointerMove({ x: 10, y: 10 }, { button: 0 })
    events.pointerUp({ x: 10, y: 10 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'ellipse',
      rotationDeg: 0,
      points: [
        { x: 60, y: 50 },
        { x: 50, y: 40 },
      ],
    })
    controller.dispose()
  })

  it('previews and commits elliptical zones from snap-adjusted grid points', () => {
    // At scale=4, gridInterval() returns 5m.
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('ellipse')

    events.pointerDown({ x: 43, y: 87 }, { button: 0 })
    events.pointerMove({ x: 148, y: 254 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('40px')
    expect(preview?.style.top).toBe('80px')
    expect(preview?.style.width).toBe('100px')
    expect(preview?.style.height).toBe('180px')
    expect(preview?.style.borderRadius).toBe('50%')

    events.pointerUp({ x: 148, y: 254 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'ellipse',
      rotationDeg: 0,
      points: [
        { x: 22.5, y: 42.5 },
        { x: 12.5, y: 22.5 },
      ],
    })
    controller.dispose()
  })

  it('shows live elliptical zone measurements while drawing without persisting them', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('ellipse')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 100 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      'W 60 m',
      'H 80 m',
      '3770 m²',
    ])
    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('shows elliptical zone measurements when one top-level ellipse is selected', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'ellipse-1',
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 60 },
          { x: 30, y: 20 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 80, y: 60 }, { button: 0 })
    events.pointerUp({ x: 80, y: 60 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      'W 60 m',
      'H 40 m',
      '1885 m²',
    ])
    controller.dispose()
  })

  it('suppresses elliptical zone measurements for multi-selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        {
          kind: 'zone',
          locked: false,
          name: 'ellipse-1',
          zoneType: 'ellipse',
          rotationDeg: 0,
          points: [
            { x: 50, y: 60 },
            { x: 30, y: 20 },
          ],
          fillColor: null,
          notes: null,
        },
        {
          kind: 'zone',
          locked: false,
          name: 'ellipse-2',
          zoneType: 'ellipse',
          rotationDeg: 0,
          points: [
            { x: 150, y: 60 },
            { x: 30, y: 20 },
          ],
          fillColor: null,
          notes: null,
        },
      ]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 80, y: 60 }, { button: 0 })
    events.pointerUp({ x: 80, y: 60 }, { button: 0 })
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    events.pointerDown({ x: 180, y: 60 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 180, y: 60 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('does not commit too-small elliptical zones', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('ellipse')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 10.2, y: 10.4 }, { button: 0 })
    events.pointerUp({ x: 10.2, y: 10.4 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('selects elliptical zones through ellipse hit testing', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'zone-ellipse',
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 50 },
          { x: 30, y: 20 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 80, y: 50 }, { button: 0 })
    events.pointerUp({ x: 80, y: 50 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-ellipse']))
    expect(deps.setSelection).toHaveBeenCalledWith(new Set(['zone-ellipse']))
    controller.dispose()
  })

  it('moves elliptical zones without changing their radii', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'zone-ellipse',
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 50 },
          { x: 30, y: 20 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 80, y: 50 }, { button: 0 })
    events.pointerMove({ x: 90, y: 65 }, { button: 0 })
    events.pointerUp({ x: 90, y: 65 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-ellipse']))
    expect(store.persisted.zones[0]?.points).toEqual([
      { x: 60, y: 65 },
      { x: 30, y: 20 },
    ])
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    controller.dispose()
  })

  it('creates a polygonal zone from clicked vertices and an Enter close action', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })

    const line = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(line?.getAttribute('points')).toBe('10,10 60,10')

    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 50 }, { button: 0 })
    events.keyDown({ key: 'Enter' })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'polygon',
      rotationDeg: 0,
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
      ],
    })
    expect(store.toCanopiFile().zones[0]).toMatchObject({
      zone_type: 'polygon',
      rotation: 0,
      locked: false,
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-polygon')
    expect(deps.setSelection).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('does not create polygonal zones on a locked Zones Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 40 }, { button: 0 })
    events.keyDown({ key: 'Enter', cancelable: true })

    expect(store.persisted.zones).toHaveLength(0)
    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('previews polygonal zone active edges from snap-adjusted grid points', () => {
    // At scale=4, gridInterval() returns 5m.
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 43, y: 87 }, { button: 0 })
    events.pointerMove({ x: 148, y: 254 }, { button: 0 })

    const line = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(line?.getAttribute('points')).toBe('40,80 140,260')
    controller.dispose()
  })

  it('shows a live polygonal zone active-edge measurement while drawing', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual(['50 m'])
    controller.dispose()
  })

  it('clears existing selection when starting a polygonal zone draft', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 80, y: 80 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    deps.setSelection(['plant-1'])
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })

    expect(selectedObjectIds.value.size).toBe(0)
    expect(deps.clearSelection).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('shows polygonal zone draft edge measurements, closing edge, and live area', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 50 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      '50 m',
      '40 m',
      '64 m',
      '1000 m²',
    ])
    controller.dispose()
  })

  it('shows selected polygonal zone edge measurements and area', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'polygon-1',
        zoneType: 'polygon',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 50 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 40, y: 10 }, { button: 0 })
    events.pointerUp({ x: 40, y: 10 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      '50 m',
      '40 m',
      '64 m',
      '1000 m²',
    ])
    controller.dispose()
  })

  it('suppresses polygonal zone measurements for multi-selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        {
          kind: 'zone',
          locked: false,
          name: 'polygon-1',
          zoneType: 'polygon',
          rotationDeg: 0,
          points: [
            { x: 10, y: 10 },
            { x: 60, y: 10 },
            { x: 60, y: 50 },
          ],
          fillColor: null,
          notes: null,
        },
        {
          kind: 'zone',
          locked: false,
          name: 'polygon-2',
          zoneType: 'polygon',
          rotationDeg: 0,
          points: [
            { x: 100, y: 10 },
            { x: 150, y: 10 },
            { x: 150, y: 50 },
          ],
          fillColor: null,
          notes: null,
        },
      ]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 40, y: 10 }, { button: 0 })
    events.pointerUp({ x: 40, y: 10 }, { button: 0 })
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    events.pointerDown({ x: 130, y: 10 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 130, y: 10 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('does not select polygonal zones from empty bounding-box space', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'polygon-1',
        zoneType: 'polygon',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 50 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 15, y: 45 }, { button: 0 })
    events.pointerUp({ x: 15, y: 45 }, { button: 0 })

    expect(selectedObjectIds.value.size).toBe(0)
    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('shows selected linear zone length from stroke-proximity hit testing', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 50, y: 13 }, { button: 0 })
    events.pointerUp({ x: 50, y: 13 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['line-1']))
    expect(zoneMeasurementTexts(container)).toEqual(['100 m'])
    controller.dispose()
  })

  it('does not select linear zones from empty bounding-box space', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 60 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 60, y: 60 }, { button: 0 })
    events.pointerUp({ x: 60, y: 60 }, { button: 0 })

    expect(selectedObjectIds.value.size).toBe(0)
    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('band-selects linear zones when the selection rectangle crosses the segment', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 50 },
          { x: 110, y: 50 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 80, y: 60 }, { button: 0 })
    events.pointerUp({ x: 80, y: 60 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['line-1']))
    controller.dispose()
  })

  it('closes a polygonal zone by clicking the first vertex', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 50 }, { button: 0 })
    events.pointerDown({ x: 12, y: 11 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'polygon',
      rotationDeg: 0,
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-polygon')
    controller.dispose()
  })

  it('cancels polygonal zone drafts with Escape without dirtying the scene', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.keyDown({ key: 'Escape' })

    expect(store.persisted.zones).toHaveLength(0)
    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('removes the last polygonal zone draft vertex with Backspace', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 50 }, { button: 0 })
    events.keyDown({ key: 'Backspace' })

    const line = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(line?.getAttribute('points')).toBe('10,10 60,50')
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('undoes and redoes polygonal zone draft vertices without dirtying the scene', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 50 }, { button: 0 })

    expect(controller.canUndoTransientHistory()).toBe(true)
    expect(controller.undoTransientHistory()).toBe(true)

    const afterUndo = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(afterUndo?.getAttribute('points')).toBe('10,10 60,50')
    expect(controller.canRedoTransientHistory()).toBe(true)

    expect(controller.redoTransientHistory()).toBe(true)

    const afterRedo = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(afterRedo?.getAttribute('points')).toBe('10,10 60,10 60,50')
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('undoes the only polygonal zone draft vertex and can redo it', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })

    expect(controller.undoTransientHistory()).toBe(true)
    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(controller.canUndoTransientHistory()).toBe(false)
    expect(controller.canRedoTransientHistory()).toBe(true)

    expect(controller.redoTransientHistory()).toBe(true)

    const afterRedo = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(afterRedo?.getAttribute('points')).toBe('10,10 10,10')
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('cancels redo-only polygonal zone draft history with Escape', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    expect(controller.undoTransientHistory()).toBe(true)
    expect(controller.canRedoTransientHistory()).toBe(true)

    events.keyDown({ key: 'Escape' })

    expect(controller.canRedoTransientHistory()).toBe(false)
    expect(controller.redoTransientHistory()).toBe(false)
    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('clears polygonal zone draft redo when a new vertex branches the draft', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    expect(controller.undoTransientHistory()).toBe(true)
    expect(controller.canRedoTransientHistory()).toBe(true)

    events.pointerDown({ x: 60, y: 50 }, { button: 0 })

    expect(controller.canRedoTransientHistory()).toBe(false)
    expect(controller.redoTransientHistory()).toBe(false)
    controller.dispose()
  })

  it('commits only visible polygonal zone draft vertices after undo', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 50 }, { button: 0 })
    events.pointerDown({ x: 10, y: 50 }, { button: 0 })
    expect(controller.undoTransientHistory()).toBe(true)
    events.keyDown({ key: 'Enter' })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'polygon',
      rotationDeg: 0,
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
      ],
    })
    expect(controller.canRedoTransientHistory()).toBe(false)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-polygon')
    controller.dispose()
  })

  it('clears polygonal zone draft redo on cancellation and tool switch', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    expect(controller.undoTransientHistory()).toBe(true)
    expect(controller.canRedoTransientHistory()).toBe(true)
    events.keyDown({ key: 'Escape' })
    expect(controller.canRedoTransientHistory()).toBe(false)

    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    events.pointerDown({ x: 80, y: 20 }, { button: 0 })
    expect(controller.undoTransientHistory()).toBe(true)
    expect(controller.canRedoTransientHistory()).toBe(true)
    controller.setTool('select')

    expect(controller.canUndoTransientHistory()).toBe(false)
    expect(controller.canRedoTransientHistory()).toBe(false)
    controller.dispose()
  })

  it('preserves polygonal zone drafts while space-panning the canvas', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()

    events.keyDown({ code: 'Space' })
    events.pointerDown({ x: 200, y: 150 }, { button: 0 })
    events.pointerMove({ x: 220, y: 150 }, { button: 0 })
    events.pointerUp({ x: 220, y: 150 }, { button: 0 })
    events.keyUp({ code: 'Space' })

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('preserves polygonal zone drafts while middle-button panning the canvas', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 200, y: 150 }, { button: 1 })
    events.pointerMove({ x: 220, y: 150 }, { button: 1 })
    events.pointerUp({ x: 220, y: 150 }, { button: 1 })

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('removes polygonal zone draft and measurement overlays on controller dispose', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()
    expect(zoneMeasurementTexts(container)).toEqual(['50 m'])

    controller.dispose()

    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(zoneMeasurementTexts(container)).toEqual([])
  })

  it('does not commit degenerate polygonal zones', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 100, y: 10 }, { button: 0 })
    events.keyDown({ key: 'Enter' })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('previews and commits rectangle zones from snap-adjusted grid points', () => {
    // At scale=4, gridInterval() returns 5m.
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('rectangle')

    events.pointerDown({ x: 43, y: 87 }, { button: 0 })
    events.pointerMove({ x: 148, y: 254 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('40px')
    expect(preview?.style.top).toBe('80px')
    expect(preview?.style.width).toBe('100px')
    expect(preview?.style.height).toBe('180px')

    events.pointerUp({ x: 148, y: 254 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'rect',
      rotationDeg: 0,
      points: [
        { x: 10, y: 20 },
        { x: 35, y: 20 },
        { x: 35, y: 65 },
        { x: 10, y: 65 },
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rectangle')
    controller.dispose()
  })

  it('previews and commits rectangle zones from snap-adjusted guide points', () => {
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGuidesEnabled.value = true
    store.updatePersisted((draft) => {
      draft.guides = [
        { id: 'guide-v-start', axis: 'v', position: 12 },
        { id: 'guide-h-start', axis: 'h', position: 22 },
        { id: 'guide-v-end', axis: 'v', position: 36 },
        { id: 'guide-h-end', axis: 'h', position: 61 },
      ]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('rectangle')

    events.pointerDown({ x: 49, y: 85 }, { button: 0 })
    events.pointerMove({ x: 142, y: 243 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('48px')
    expect(preview?.style.top).toBe('88px')
    expect(preview?.style.width).toBe('96px')
    expect(preview?.style.height).toBe('156px')

    events.pointerUp({ x: 142, y: 243 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'rect',
      rotationDeg: 0,
      points: [
        { x: 12, y: 22 },
        { x: 36, y: 22 },
        { x: 36, y: 61 },
        { x: 12, y: 61 },
      ],
    })
    controller.dispose()
  })

  it('shows live rectangle zone measurements while drawing without persisting them', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('rectangle')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 100 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      '60 m',
      '80 m',
      '60 m',
      '80 m',
      '4800 m²',
    ])
    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('shows rectangle zone measurements when one top-level zone is selected', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'zone-1',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
          { x: 110, y: 90 },
          { x: 10, y: 90 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerUp({ x: 10, y: 20 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-1']))
    expect(zoneMeasurementTexts(container)).toEqual([
      '100 m',
      '80 m',
      '100 m',
      '80 m',
      '8000 m²',
    ])
    controller.dispose()
  })

  it('suppresses rectangle zone measurements for multi-selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        {
          kind: 'zone',
          locked: false,
          name: 'zone-1',
          zoneType: 'rect',
          rotationDeg: 0,
          points: [
            { x: 10, y: 10 },
            { x: 110, y: 10 },
            { x: 110, y: 90 },
            { x: 10, y: 90 },
          ],
          fillColor: null,
          notes: null,
        },
        {
          kind: 'zone',
          locked: false,
          name: 'zone-2',
          zoneType: 'rect',
          rotationDeg: 0,
          points: [
            { x: 150, y: 10 },
            { x: 250, y: 10 },
            { x: 250, y: 90 },
            { x: 150, y: 90 },
          ],
          fillColor: null,
          notes: null,
        },
      ]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerUp({ x: 10, y: 20 }, { button: 0 })
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    events.pointerDown({ x: 150, y: 20 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 150, y: 20 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-1', 'zone-2']))
    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('suppresses rectangle zone measurements for group selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'zone-1',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
          { x: 110, y: 90 },
          { x: 10, y: 90 },
        ],
        fillColor: null,
        notes: null,
      }]
      draft.groups = [{
        kind: 'group',
        locked: false,
        id: 'group-1',
        name: null,
        members: [{ kind: 'zone', id: 'zone-1' }],
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerUp({ x: 10, y: 20 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['group-1']))
    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('hides short rectangle edge measurements while keeping the area visible', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'zone-1',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 110 },
          { x: 10, y: 110 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerUp({ x: 10, y: 20 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      '100 m',
      '100 m',
      '2000 m²',
    ])
    controller.dispose()
  })

  it('suppresses selected rectangle zone measurements when the zones layer is hidden', () => {
    store.updatePersisted((draft) => {
      const zonesLayer = draft.layers.find((layer) => layer.name === 'zones')
      if (zonesLayer) zonesLayer.visible = false
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'zone-1',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
          { x: 110, y: 90 },
          { x: 10, y: 90 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    deps.setSelection(['zone-1'])
    const controller = new SceneInteractionController(deps as any)

    controller.refreshMeasurements()

    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('selects Zones by boundary proximity while interior clicks pass through', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 90 },
        { x: 10, y: 90 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 60, y: 50 }, { button: 0 })
    events.pointerUp({ x: 60, y: 50 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set())
    expect(deps.setSelection).not.toHaveBeenCalledWith(new Set(['zone-1']))

    events.pointerDown({ x: 10, y: 50 }, { button: 0 })
    events.pointerUp({ x: 10, y: 50 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-1']))
    controller.dispose()
  })

  it('prioritizes Placed Plants over Zone boundary hits', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 90 },
        { x: 10, y: 90 },
      ])]
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 10, y: 50 })]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 10, y: 50 }, { button: 0 })
    events.pointerUp({ x: 10, y: 50 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    controller.dispose()
  })

  it('reshapes Linear Zones by dragging endpoint Zone Control Points with live measurements', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 30, y: 10 }, { button: 0 })
    events.pointerUp({ x: 30, y: 10 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="line-endpoint"][data-zone-control-point-index="1"]',
    )!
    const start = zoneControlPointCenter(container, 'line-endpoint', 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 80, y: 10 }, { button: 0 })

    expect(store.persisted.zones[0]?.points[1]).toEqual({ x: 80, y: 10 })
    expect(zoneMeasurementTexts(container)).toEqual(['70 m'])

    events.pointerUp({ x: 80, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-zone-control-point')
    controller.dispose()
  })

  it('does not reshape Linear Zones or commit edits from no-op Zone Control Point taps', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 30, y: 10 }, { button: 0 })
    events.pointerUp({ x: 30, y: 10 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="line-endpoint"][data-zone-control-point-index="1"]',
    )!
    const start = zoneControlPointCenter(container, 'line-endpoint', 1)
    const hitTargetOffset = { x: start.x + 5, y: start.y }
    events.pointerDown(hitTargetOffset, { button: 0, target: handle })
    events.pointerUp(hitTargetOffset, { button: 0, target: handle })

    expect(store.persisted.zones[0]?.points).toEqual([
      { x: 10, y: 10 },
      { x: 60, y: 10 },
    ])
    expect(zoneMeasurementTexts(container)).toEqual(['50 m'])
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('drags Measurement Guide endpoints with live distance labels', () => {
    store.updatePersisted((draft) => {
      draft.plants = []
      draft.zones = []
      draft.annotations = []
      draft.measurementGuides = [
        makeMeasurementGuide('measurement-guide-1', { x: 10, y: 10 }, { x: 60, y: 10 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 30, y: 10 }, { button: 0 })
    events.pointerUp({ x: 30, y: 10 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-measurement-guide-control-point-index="1"]',
    )!
    const start = measurementGuideControlPointCenter(container, 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 80, y: 10 }, { button: 0 })

    expect(store.persisted.measurementGuides?.[0]?.end).toEqual({ x: 80, y: 10 })
    expect(zoneMeasurementTexts(container)).toEqual(['70 m'])

    events.pointerUp({ x: 80, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-measurement-guide-control-point')
    controller.dispose()
  })

  it('aborts Measurement Guide endpoint drags on Escape and skips no-op commits', () => {
    store.updatePersisted((draft) => {
      draft.plants = []
      draft.zones = []
      draft.annotations = []
      draft.measurementGuides = [
        makeMeasurementGuide('measurement-guide-1', { x: 10, y: 10 }, { x: 60, y: 10 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 30, y: 10 }, { button: 0 })
    events.pointerUp({ x: 30, y: 10 }, { button: 0 })

    let handle = container.querySelector<HTMLElement>(
      '[data-measurement-guide-control-point-index="1"]',
    )!
    let start = measurementGuideControlPointCenter(container, 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 80, y: 10 }, { button: 0 })
    events.keyDown({ key: 'Escape' })

    expect(store.persisted.measurementGuides?.[0]).toMatchObject({
      start: { x: 10, y: 10 },
      end: { x: 60, y: 10 },
    })
    expect(zoneMeasurementTexts(container)).toEqual([])

    handle = container.querySelector<HTMLElement>(
      '[data-measurement-guide-control-point-index="1"]',
    )!
    start = measurementGuideControlPointCenter(container, 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerUp(start, { button: 0, target: handle })

    expect(store.persisted.measurementGuides?.[0]).toMatchObject({
      start: { x: 10, y: 10 },
      end: { x: 60, y: 10 },
    })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('reshapes Polygonal Zones by dragging existing vertex Zone Control Points', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'poly-1',
        zoneType: 'polygon',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 10, y: 60 },
        ],
        fillColor: null,
        notes: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 10, y: 30 }, { button: 0 })
    events.pointerUp({ x: 10, y: 30 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="polygon-vertex"][data-zone-control-point-index="1"]',
    )!
    const start = zoneControlPointCenter(container, 'polygon-vertex', 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 80, y: 10 }, { button: 0 })

    expect(store.persisted.zones[0]?.points[1]).toEqual({ x: 80, y: 10 })
    expect(zoneMeasurementTexts(container)).toContain('1750 m²')

    events.pointerUp({ x: 80, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-zone-control-point')
    controller.dispose()
  })

  it('resizes Rectangular Zones from corner Zone Control Points while preserving rectangle geometry', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('rect-1', [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
        { x: 10, y: 50 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 10, y: 30 }, { button: 0 })
    events.pointerUp({ x: 10, y: 30 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="rect-corner"][data-zone-control-point-index="2"]',
    )!
    const start = zoneControlPointCenter(container, 'rect-corner', 2)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 90, y: 70 }, { button: 0 })

    expect(store.persisted.zones[0]?.points).toEqual([
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 70 },
      { x: 10, y: 70 },
    ])
    expect(zoneMeasurementTexts(container)).toContain('4800 m²')

    events.pointerUp({ x: 90, y: 70 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-zone-control-point')
    controller.dispose()
  })

  it('resizes Elliptical Zones from cardinal Zone Control Points with live measurements', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'ellipse-1',
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 50 },
          { x: 20, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 70, y: 50 }, { button: 0 })
    events.pointerUp({ x: 70, y: 50 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="ellipse-east"][data-zone-control-point-index="0"]',
    )!
    const start = zoneControlPointCenter(container, 'ellipse-east', 0)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 90, y: 50 }, { button: 0 })

    expect(store.persisted.zones[0]?.points).toEqual([
      { x: 60, y: 50 },
      { x: 30, y: 10 },
    ])
    expect(zoneMeasurementTexts(container)).toEqual(['W 60 m', 'H 20 m', '942 m²'])

    events.pointerUp({ x: 90, y: 50 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-zone-control-point')
    controller.dispose()
  })

  it('places plant-stamp plants using species default color and symbol', () => {
    store.updatePersisted((draft) => {
      draft.plantSpeciesColors = {
        'Malus domestica': '#C44230',
      }
      draft.plantSpeciesSymbols = {
        'Malus domestica': 'tree',
      }
    })
    selectPlantStampSource({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-stamp')

    events.pointerDown({ x: 50, y: 70 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#C44230',
      symbol: 'tree',
      position: { x: 50, y: 70 },
    })
    controller.dispose()
  })

  it('does not place Plant Stamp plants on a locked Plants Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'plants' ? { ...layer, locked: true } : layer
      ))
    })
    selectPlantStampSource({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-stamp')

    events.pointerDown({ x: 50, y: 70 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('clears Plant Stamp source on controller dispose without writing scene data', () => {
    selectPlantStampSource({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })

    const controller = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
    controller.setTool('plant-stamp')

    expect(readPlantStampSource()).not.toBeNull()
    controller.dispose()

    expect(readPlantStampSource()).toBeNull()
    expect(store.persisted.plants).toHaveLength(0)
  })

  it('creates tool objects when native randomUUID is unavailable', () => {
    withoutNativeRandomUUID(() => {
      let rectangleController: SceneInteractionController | null = null
      let plantController: SceneInteractionController | null = null

      try {
        rectangleController = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
        rectangleController.setTool('rectangle')

        events.pointerDown({ x: 10, y: 20 }, { button: 0 })
        events.pointerMove({ x: 40, y: 60 }, { button: 0 })
        events.pointerUp({ x: 40, y: 60 }, { button: 0 })

        expect(store.persisted.zones).toHaveLength(1)
        rectangleController.dispose()
        rectangleController = null

        selectPlantStampSource({
          canonical_name: 'Malus domestica',
          common_name: 'Apple',
          stratum: 'high',
          width_max_m: 4,
        })
        plantController = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
        plantController.setTool('plant-stamp')

        events.pointerDown({ x: 50, y: 70 }, { button: 0 })

        expect(store.persisted.plants).toHaveLength(1)
      } finally {
        rectangleController?.dispose()
        plantController?.dispose()
      }
    })
  })

  it('snaps dragged plant to grid when snap is enabled', () => {
    // At scale=4, gridInterval() returns 5m (first NICE_DISTANCE where d*4 >= 20)
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    store.updatePersisted((draft) => {
      draft.plants = [
        {
          kind: 'plant',
          locked: false,
          id: 'plant-1',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: null,
          canopySpreadM: 2,
          position: { x: 50, y: 50 },
          rotationDeg: null,
          scale: 2,
          notes: null,
          plantedDate: null,
          quantity: 1,
        },
        makePlant('plant-2', 'Pyrus communis', { x: 70, y: 60 }),
      ]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    // Plant at (50,50). Screen = world * scale = (200,200).
    // Click screen (201,202) → world (50.25, 50.5). snapRef = plant at (50,50).
    // Drag screen (232,248) → world (58,62). rawDelta = (7.75, 11.5).
    // candidate = (50+7.75, 50+11.5) = (57.75, 61.5) → snaps to (60,60).
    // delta = (60-50, 60-50) = (10,10). Final = (60,60).
    events.pointerDown({ x: 201, y: 202 }, { button: 0 })
    events.pointerMove({ x: 232, y: 248 }, { button: 0 })
    expect(Array.from(container.querySelectorAll<HTMLElement>('[data-plant-drag-distance-label]'))
      .map((label) => label.textContent)).toEqual(['10 m'])
    events.pointerUp({ x: 232, y: 248 }, { button: 0 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 60, y: 60 })
    expect(container.querySelector('[data-plant-drag-distance-label]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    controller.dispose()
  })

  it('snaps plant-stamp placement to the grid when snap is enabled', () => {
    // At scale=4, gridInterval() returns 5m
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    selectPlantStampSource({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })

    const controller = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
    controller.setTool('plant-stamp')

    // Screen (53,67) → world (13.25, 16.75) → snaps to (15, 15) at 5m interval
    events.pointerDown({ x: 53, y: 67 }, { button: 0 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 15, y: 15 })
    controller.dispose()
  })

  it('ignores Measurement Guides in Object Stamp sampling and placement', () => {
    store.updatePersisted((draft) => {
      draft.plants = []
      draft.zones = []
      draft.annotations = []
      draft.measurementGuides = [
        makeMeasurementGuide('measurement-guide-1', { x: 20, y: 40 }, { x: 120, y: 40 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 60, y: 40 }, { button: 0 })
    events.pointerMove({ x: 150, y: 90 }, { button: 0 })
    events.pointerDown({ x: 150, y: 90 }, { button: 0 })

    expect(store.persisted.measurementGuides).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(0)
    expect(store.persisted.zones).toHaveLength(0)
    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('samples a placed plant with Object Stamp and places anchored clones', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#C44230',
        symbol: 'triangle',
        stratum: 'high',
        canopySpreadM: 4,
        position: { x: 50, y: 60 },
        rotationDeg: 15,
        scale: 4,
        notes: 'Source plant',
        plantedDate: '2026-02-01',
        quantity: 2,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 54, y: 63 }, { button: 0 })
    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerMove({ x: 100, y: 120 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    events.pointerDown({ x: 100, y: 120 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(2)
    const clone = store.persisted.plants[1]!
    expect(clone.id).not.toBe('plant-1')
    expect(clone).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#C44230',
      symbol: 'triangle',
      stratum: 'high',
      canopySpreadM: 4,
      position: { x: 96, y: 117 },
      rotationDeg: 15,
      scale: 4,
      notes: 'Source plant',
      plantedDate: '2026-02-01',
      quantity: 2,
    })
    expect(selectedObjectIds.value).toEqual(new Set([clone.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    controller.dispose()
  })

  it('snaps Object Stamp placement by the sampled plant anchor', () => {
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 4,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        scale: 4,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    // Screen (44, 44) -> world (11, 11), so the sampled anchor is +1,+1 from the plant position.
    events.pointerDown({ x: 44, y: 44 }, { button: 0 })
    // Screen (93, 107) -> world (23.25, 26.75), snapped to (25, 25) at this zoom level.
    events.pointerDown({ x: 93, y: 107 }, { button: 0 })

    expect(store.persisted.plants[1]?.position).toEqual({ x: 24, y: 24 })
    controller.dispose()
  })

  it('clears loaded Object Stamp source and returns to select on Escape', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const setTool = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setTool })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.keyDown({ key: 'Escape' })
    events.pointerDown({ x: 90, y: 90 }, { button: 0 })

    expect(setTool).toHaveBeenCalledWith('select')
    expect(store.persisted.plants).toHaveLength(1)
    controller.dispose()
  })

  it('clears loaded Object Stamp source when changing tools', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    controller.setTool('select')
    controller.setTool('object-stamp')
    events.pointerDown({ x: 90, y: 90 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(1)
    controller.dispose()
  })

  it('clears loaded Object Stamp preview on controller dispose', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 90, y: 90 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    controller.dispose()

    expect(preview?.isConnected).toBe(false)
  })

  it('blocks Object Stamp sampling and placement for locked or hidden plant sources', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'plant-1',
        locked: true,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        scale: 2,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerDown({ x: 90, y: 90 }, { button: 0 })
    expect(store.persisted.plants).toHaveLength(1)

    store.updatePersisted((draft) => {
      const plant = draft.plants.find((entry) => entry.id === 'plant-1')
      if (plant) plant.locked = false
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    store.updatePersisted((draft) => {
      const plantsLayer = draft.layers.find((layer) => layer.name === 'plants')
      if (plantsLayer) plantsLayer.visible = false
    })
    events.pointerDown({ x: 90, y: 90 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('samples a zone with Object Stamp and places anchored collision-safe clones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        {
          kind: 'zone',
          locked: false,
          name: 'Kitchen bed',
          zoneType: 'rect',
          rotationDeg: 0,
          points: [
            { x: 10, y: 20 },
            { x: 50, y: 20 },
            { x: 50, y: 60 },
            { x: 10, y: 60 },
          ],
          fillColor: '#A06B1F',
          notes: 'Annuals',
        },
        {
          kind: 'zone',
          locked: false,
          name: 'Kitchen bed copy',
          zoneType: 'rect',
          rotationDeg: 0,
          points: [
            { x: 200, y: 200 },
            { x: 220, y: 200 },
            { x: 220, y: 220 },
            { x: 200, y: 220 },
          ],
          fillColor: null,
          notes: null,
        },
      ]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 10, y: 30 }, { button: 0 })
    expect(store.persisted.zones).toHaveLength(2)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerMove({ x: 120, y: 150 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    events.pointerDown({ x: 120, y: 150 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(3)
    const clone = store.persisted.zones[2]!
    expect(clone).toMatchObject({
      name: 'Kitchen bed copy 2',
      zoneType: 'rect',
      rotationDeg: 0,
      points: [
        { x: 120, y: 140 },
        { x: 160, y: 140 },
        { x: 160, y: 180 },
        { x: 120, y: 180 },
      ],
      fillColor: '#A06B1F',
      notes: 'Annuals',
    })
    expect(selectedObjectIds.value).toEqual(new Set(['Kitchen bed copy 2']))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    controller.dispose()
  })

  it('samples a linear zone with Object Stamp and places anchored clones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'Hedgerow',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 20 },
          { x: 50, y: 60 },
        ],
        fillColor: '#A06B1F',
        notes: 'Boundary',
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 120, y: 150 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.borderTop).toContain('solid')

    events.pointerDown({ x: 120, y: 150 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(2)
    expect(store.persisted.zones[1]).toMatchObject({
      name: 'Hedgerow copy',
      zoneType: 'line',
      rotationDeg: 0,
      points: [
        { x: 110, y: 140 },
        { x: 150, y: 180 },
      ],
      fillColor: '#A06B1F',
      notes: 'Boundary',
    })
    expect(selectedObjectIds.value).toEqual(new Set(['Hedgerow copy']))
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    controller.dispose()
  })

  it('samples an annotation with Object Stamp and places anchored clones with fresh ids', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [{
        kind: 'annotation',
        locked: false,
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 20, y: 30 },
        text: 'Guild note',
        fontSize: 20,
        rotationDeg: 12,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 30, y: 40 }, { button: 0 })
    expect(store.persisted.annotations).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerMove({ x: 100, y: 110 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    events.pointerDown({ x: 100, y: 110 }, { button: 0 })

    expect(store.persisted.annotations).toHaveLength(2)
    const clone = store.persisted.annotations[1]!
    expect(clone.id).not.toBe('annotation-1')
    expect(clone).toMatchObject({
      annotationType: 'text',
      position: { x: 90, y: 100 },
      text: 'Guild note',
      fontSize: 20,
      rotationDeg: 12,
    })
    expect(selectedObjectIds.value).toEqual(new Set([clone.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    controller.dispose()
  })

  it('snaps Object Stamp placement by the sampled annotation anchor', () => {
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    store.updatePersisted((draft) => {
      draft.annotations = [{
        kind: 'annotation',
        locked: false,
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 10, y: 10 },
        text: 'Note',
        fontSize: 20,
        rotationDeg: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    // Screen (44, 44) -> world (11, 11), so the sampled anchor is +1,+1 from the annotation position.
    events.pointerDown({ x: 44, y: 44 }, { button: 0 })
    // Screen (93, 107) -> world (23.25, 26.75), snapped to (25, 25) at this zoom level.
    events.pointerDown({ x: 93, y: 107 }, { button: 0 })

    expect(store.persisted.annotations[1]?.position).toEqual({ x: 24, y: 24 })
    controller.dispose()
  })

  it('preserves elliptical zone radii when stamping zones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'Oval bed',
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 60 },
          { x: 20, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 70, y: 60 }, { button: 0 })
    events.pointerDown({ x: 100, y: 100 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(2)
    expect(store.persisted.zones[1]).toMatchObject({
      name: 'Oval bed copy',
      zoneType: 'ellipse',
      rotationDeg: 0,
      points: [
        { x: 80, y: 100 },
        { x: 20, y: 10 },
      ],
    })
    controller.dispose()
  })

  it('blocks Object Stamp sampling and placement for locked or hidden zone and annotation sources', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        name: 'Kitchen bed',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 50 },
          { x: 10, y: 50 },
        ],
        fillColor: null,
        notes: null,
        locked: false,
      }]
      draft.annotations = [{
        kind: 'annotation',
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 100, y: 30 },
        text: 'Note',
        fontSize: 20,
        rotationDeg: null,
        locked: false,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    store.updatePersisted((draft) => {
      draft.zones = draft.zones.map((zone) =>
        zone.name === 'Kitchen bed' ? { ...zone, locked: true } : zone,
      )
    })
    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })
    expect(store.persisted.zones).toHaveLength(1)

    store.updatePersisted((draft) => {
      draft.zones = draft.zones.map((zone) =>
        zone.name === 'Kitchen bed' ? { ...zone, locked: false } : zone,
      )
    })
    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    store.updatePersisted((draft) => {
      const zonesLayer = draft.layers.find((layer) => layer.name === 'zones')
      if (zonesLayer) zonesLayer.visible = false
    })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })
    expect(store.persisted.zones).toHaveLength(1)

    controller.setTool('select')
    controller.setTool('object-stamp')
    store.updatePersisted((draft) => {
      const zonesLayer = draft.layers.find((layer) => layer.name === 'zones')
      if (zonesLayer) zonesLayer.visible = true
    })

    store.updatePersisted((draft) => {
      draft.annotations = draft.annotations.map((annotation) =>
        annotation.id === 'annotation-1' ? { ...annotation, locked: true } : annotation,
      )
    })
    events.pointerDown({ x: 104, y: 34 }, { button: 0 })
    events.pointerDown({ x: 150, y: 90 }, { button: 0 })
    expect(store.persisted.annotations).toHaveLength(1)

    store.updatePersisted((draft) => {
      draft.annotations = draft.annotations.map((annotation) =>
        annotation.id === 'annotation-1' ? { ...annotation, locked: false } : annotation,
      )
    })
    events.pointerDown({ x: 104, y: 34 }, { button: 0 })
    store.updatePersisted((draft) => {
      const annotationsLayer = draft.layers.find((layer) => layer.name === 'annotations')
      if (annotationsLayer) annotationsLayer.locked = true
    })
    events.pointerDown({ x: 150, y: 90 }, { button: 0 })

    expect(store.persisted.annotations).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('samples an object group with Object Stamp and places cloned members with remapped group membership', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#C44230',
        stratum: 'high',
        canopySpreadM: 4,
        position: { x: 40, y: 40 },
        rotationDeg: 15,
        scale: 4,
        notes: 'Tree',
        plantedDate: null,
        quantity: 1,
      }]
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'Kitchen bed',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 50 },
          { x: 10, y: 50 },
        ],
        fillColor: '#A06B1F',
        notes: 'Bed',
      }]
      draft.annotations = [{
        kind: 'annotation',
        locked: false,
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 60, y: 30 },
        text: 'Guild',
        fontSize: 20,
        rotationDeg: 10,
      }]
      draft.groups = [{
        kind: 'group',
        locked: false,
        id: 'group-1',
        name: 'Guild unit',
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'Kitchen bed' },
          { kind: 'annotation', id: 'annotation-1' },
        ],
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 100, y: 120 }, { button: 0 })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    events.pointerDown({ x: 100, y: 120 }, { button: 0 })

    expect(store.persisted.groups).toHaveLength(2)
    expect(store.persisted.plants).toHaveLength(2)
    expect(store.persisted.zones).toHaveLength(2)
    expect(store.persisted.annotations).toHaveLength(2)

    const clonePlant = store.persisted.plants[1]!
    const cloneZone = store.persisted.zones[1]!
    const cloneAnnotation = store.persisted.annotations[1]!
    const cloneGroup = store.persisted.groups[1]!

    expect(clonePlant.id).not.toBe('plant-1')
    expect(clonePlant).toMatchObject({
      canonicalName: 'Malus domestica',
      position: { x: 100, y: 120 },
      rotationDeg: 15,
    })
    expect(cloneZone).toMatchObject({
      name: 'Kitchen bed copy',
      points: [
        { x: 70, y: 100 },
        { x: 90, y: 100 },
        { x: 90, y: 130 },
        { x: 70, y: 130 },
      ],
      fillColor: '#A06B1F',
      notes: 'Bed',
    })
    expect(cloneAnnotation.id).not.toBe('annotation-1')
    expect(cloneAnnotation).toMatchObject({
      position: { x: 120, y: 110 },
      text: 'Guild',
      fontSize: 20,
      rotationDeg: 10,
    })
    expect(cloneGroup).toMatchObject({
      name: 'Guild unit',
      members: [
        { kind: 'plant', id: clonePlant.id },
        { kind: 'zone', id: cloneZone.name },
        { kind: 'annotation', id: cloneAnnotation.id },
      ],
    })
    expect(cloneGroup.id).not.toBe('group-1')
    expect(store.persisted.groups[0]?.members).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'Kitchen bed' },
      { kind: 'annotation', id: 'annotation-1' },
    ])
    expect(selectedObjectIds.value).toEqual(new Set([cloneGroup.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
    controller.dispose()
  })

  it('places Saved Object Stamps with full ghost preview and selected unlocked copies', () => {
    selectSavedObjectStampSource({
      version: 1,
      anchor: { x: 12, y: 24 },
      plants: [{
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#C44230',
        symbol: 'tree',
        position: { x: 12, y: 24 },
        rotationDeg: 15,
        scale: 4,
      }],
      zones: [{
        id: 'zone-1',
        name: 'Kitchen bed',
        zoneType: 'rect',
        points: [
          { x: 2, y: 10 },
          { x: 22, y: 10 },
          { x: 22, y: 30 },
          { x: 2, y: 30 },
        ],
        rotationDeg: 0,
        fillColor: '#A06B1F',
      }],
      annotations: [{
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 30, y: 20 },
        text: 'Guild',
        fontSize: 16,
        rotationDeg: 5,
      }],
      groups: [{
        id: 'group-1',
        name: 'Guild unit',
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'zone-1' },
          { kind: 'annotation', id: 'annotation-1' },
        ],
      }],
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('saved-object-stamp')

    events.pointerMove({ x: 100, y: 120 }, { button: 0 })
    expect(container.querySelectorAll('[data-saved-object-stamp-ghost]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-saved-object-stamp-part]')).toHaveLength(3)

    events.pointerDown({ x: 100, y: 120 }, { button: 0 })

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.annotations).toHaveLength(1)
    expect(store.persisted.groups).toHaveLength(1)

    const plant = store.persisted.plants[0]!
    const zone = store.persisted.zones[0]!
    const annotation = store.persisted.annotations[0]!
    const group = store.persisted.groups[0]!

    expect(plant).toMatchObject({
      locked: false,
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#C44230',
      symbol: 'tree',
      position: { x: 100, y: 120 },
      rotationDeg: 15,
      scale: 4,
      notes: null,
      plantedDate: null,
      quantity: null,
    })
    expect(zone).toMatchObject({
      locked: false,
      name: 'Kitchen bed',
      points: [
        { x: 90, y: 106 },
        { x: 110, y: 106 },
        { x: 110, y: 126 },
        { x: 90, y: 126 },
      ],
      fillColor: '#A06B1F',
      notes: null,
    })
    expect(annotation).toMatchObject({
      locked: false,
      position: { x: 118, y: 116 },
      text: 'Guild',
      fontSize: 16,
      rotationDeg: 5,
    })
    expect(group).toMatchObject({
      name: 'Guild unit',
      locked: false,
      members: [
        { kind: 'plant', id: plant.id },
        { kind: 'zone', id: zone.name },
        { kind: 'annotation', id: annotation.id },
      ],
    })
    expect(selectedObjectIds.value).toEqual(new Set([group.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-saved-object-stamp')
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).toBeNull()
    controller.dispose()
  })

  it('blocks Saved Object Stamp placement when any target Layer is locked', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'zones' ? { ...layer, locked: true } : layer,
      )
    })
    selectSavedObjectStampSource({
      version: 1,
      anchor: { x: 0, y: 0 },
      plants: [],
      zones: [{
        id: 'zone-1',
        name: 'Kitchen bed',
        zoneType: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        rotationDeg: 0,
        fillColor: null,
      }],
      annotations: [],
      groups: [],
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('saved-object-stamp')

    events.pointerDown({ x: 100, y: 120 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('places Saved Object Stamps from drag-and-drop payloads with full geometry ghost preview', () => {
    camera.setViewport({ x: 0, y: 0, scale: 2 })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    const dragData = new Map<string, string>()
    let protectedDragData = true
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      get types() {
        return Array.from(dragData.keys())
      },
      setData(type: string, value: string) {
        dragData.set(type, value)
      },
      getData(type: string) {
        if (protectedDragData) return ''
        return dragData.get(type) ?? ''
      },
    }
    writeSavedObjectStampDragData(dataTransfer, {
      id: 'stamp-1',
      name: 'Guild',
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
      payload_json: JSON.stringify({
        version: 1,
        anchor: { x: 0, y: 0 },
        plants: [{
          id: 'plant-1',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: '#C44230',
          symbol: 'tree',
          position: { x: -4, y: 0 },
          rotationDeg: null,
          scale: 4,
        }],
        zones: [{
          id: 'zone-1',
          name: 'Kitchen bed',
          zoneType: 'rect',
          points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }],
          rotationDeg: 30,
          fillColor: '#CBA24A',
        }],
        annotations: [{
          id: 'annotation-1',
          annotationType: 'text',
          position: { x: 2, y: -5 },
          text: 'Guild',
          fontSize: 11,
          rotationDeg: 45,
        }],
        groups: [],
      }),
    })

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })

    container.dispatchEvent(dragOverEvent)
    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(container.querySelectorAll('[data-saved-object-stamp-ghost]')).toHaveLength(1)
    expect(container.querySelector('[data-saved-object-stamp-part="zone"]')?.tagName.toLowerCase())
      .toBe('polygon')
    expect(container.querySelector('[data-saved-object-stamp-part="plant-symbol"] path')).toBeTruthy()
    const annotationGhost = container.querySelector<SVGTextElement>('[data-saved-object-stamp-part="annotation"]')
    expect(annotationGhost?.getAttribute('font-size')).toBe('11')
    expect(annotationGhost?.getAttribute('transform')).toContain('rotate(45')

    protectedDragData = false
    container.dispatchEvent(dropEvent)
    expect(dropEvent.defaultPrevented).toBe(true)

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#C44230',
      symbol: 'tree',
      position: { x: 36, y: 45 },
      locked: false,
    })
    expect(store.persisted.zones[0]).toMatchObject({
      name: 'Kitchen bed',
      rotationDeg: 30,
      fillColor: '#CBA24A',
    })
    expect(store.persisted.annotations[0]).toMatchObject({
      text: 'Guild',
      fontSize: 11,
      rotationDeg: 45,
      position: { x: 42, y: 40 },
    })
    expect(selectedObjectIds.value).toEqual(new Set([
      store.persisted.plants[0]!.id,
      store.persisted.zones[0]!.name,
      store.persisted.annotations[0]!.id,
    ]))
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-saved-object-stamp')
    controller.dispose()
  })

  it('blocks Saved Object Stamp drops when any target Layer is locked', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'zones' ? { ...layer, locked: true } : layer,
      )
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    const dragData = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'copy',
      get types() {
        return Array.from(dragData.keys())
      },
      setData(type: string, value: string) {
        dragData.set(type, value)
      },
      getData(type: string) {
        return dragData.get(type) ?? ''
      },
    }
    writeSavedObjectStampDragData(dataTransfer, {
      id: 'stamp-1',
      name: 'Bed',
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
      payload_json: JSON.stringify({
        version: 1,
        anchor: { x: 0, y: 0 },
        plants: [],
        zones: [{
          id: 'zone-1',
          name: 'Kitchen bed',
          zoneType: 'rect',
          points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
          rotationDeg: 0,
          fillColor: null,
        }],
        annotations: [],
        groups: [],
      }),
    })
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })

    container.dispatchEvent(dragOverEvent)
    expect(dataTransfer.dropEffect).toBe('none')
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).toBeNull()

    container.dispatchEvent(dropEvent)

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('blocks Object Stamp sampling and placement for locked group sources or locked group layers', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 4,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        scale: 4,
        notes: null,
        plantedDate: null,
        quantity: 1,
        locked: false,
      }]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        name: 'Guild unit',
        locked: false,
        members: [{ kind: 'plant', id: 'plant-1' }],
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    store.updatePersisted((draft) => {
      draft.groups = draft.groups.map((group) =>
        group.id === 'group-1' ? { ...group, locked: true } : group,
      )
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })
    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)

    store.updatePersisted((draft) => {
      draft.groups = draft.groups.map((group) =>
        group.id === 'group-1' ? { ...group, locked: false } : group,
      )
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    store.updatePersisted((draft) => {
      const plantsLayer = draft.layers.find((layer) => layer.name === 'plants')
      if (plantsLayer) plantsLayer.locked = true
    })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })

    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('blocks Object Stamp sampling and placement for group sources containing locked members', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'plant-1',
        locked: false,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 4,
        position: { x: 40, y: 40 },
        rotationDeg: null,
        scale: 4,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: 'Guild unit',
        members: [{ kind: 'plant', id: 'plant-1' }],
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    store.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) =>
        plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
      )
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })
    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)

    store.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) =>
        plant.id === 'plant-1' ? { ...plant, locked: false } : plant,
      )
    })
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    store.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) =>
        plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
      )
    })
    events.pointerDown({ x: 120, y: 120 }, { button: 0 })

    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('creates plant placements from drag-and-drop payloads through protected dragover data', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    const dragData = new Map<string, string>()
    let protectedDragData = true
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      get types() {
        return Array.from(dragData.keys())
      },
      setData(type: string, value: string) {
        dragData.set(type, value)
      },
      getData(type: string) {
        if (protectedDragData) return ''
        return dragData.get(type) ?? ''
      },
    }
    writePlantStampDragData(dataTransfer, {
      canonical_name: 'Pyrus communis',
      common_name: 'Pear',
      stratum: 'mid',
      width_max_m: 3,
    })

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined

    container.dispatchEvent(dragOverEvent)
    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(preview?.style.display).toBe('block')

    protectedDragData = false
    container.dispatchEvent(dropEvent)
    expect(dropEvent.defaultPrevented).toBe(true)

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Pyrus communis',
      commonName: 'Pear',
      position: { x: 80, y: 90 },
      scale: 3,
    })
    expect(preview?.style.display).toBe('none')
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drop')
    controller.dispose()
  })

  it('returns to Select and reactivates the canvas after a native plant drop', async () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 30, y: 30 }),
      ]
    })
    const sourceControl = document.createElement('button')
    document.body.appendChild(sourceControl)
    sourceControl.focus()
    expect(document.activeElement).toBe(sourceControl)
    const setTool = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setTool })
    const controller = new SceneInteractionController(deps as any)
    const originalFocus = container.focus.bind(container)
    let nativeDropInProgress = false
    const focusSpy = vi.spyOn(container, 'focus').mockImplementation((options?: FocusOptions) => {
      if (nativeDropInProgress) return
      originalFocus(options)
    })
    try {
      controller.setTool('plant-stamp')
      const dragData = new Map<string, string>()
      const dataTransfer = {
        effectAllowed: 'none',
        setData(type: string, value: string) {
          dragData.set(type, value)
        },
        getData(type: string) {
          return dragData.get(type) ?? ''
        },
      }
      writePlantStampDragData(dataTransfer, {
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        stratum: 'mid',
        width_max_m: 3,
      })

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperties(dropEvent, {
        clientX: { configurable: true, value: 120 },
        clientY: { configurable: true, value: 90 },
        dataTransfer: {
          configurable: true,
          value: dataTransfer,
        },
      })

      nativeDropInProgress = true
      try {
        container.dispatchEvent(dropEvent)
      } finally {
        nativeDropInProgress = false
      }
      const droppedPlant = store.persisted.plants.find((plant) => plant.id !== 'plant-1')

      expect(droppedPlant).toBeDefined()
      expect(selectedObjectIds.value).toEqual(new Set([droppedPlant!.id]))
      expect(setTool).toHaveBeenCalledWith('select')
      expect(document.activeElement).toBe(sourceControl)
      await nextAnimationFrame()
      expect(document.activeElement).toBe(container)
      expect(focusSpy).toHaveBeenCalledTimes(2)

      sourceControl.focus()
      expect(document.activeElement).toBe(sourceControl)

      const firstDragPointerDown = events.pointerDown({ x: 120, y: 90 }, { button: 0 })
      expect(firstDragPointerDown.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(container)
      events.pointerMove({ x: 140, y: 100 }, { button: 0 })
      events.pointerUp({ x: 140, y: 100 }, { button: 0 })

      expect(store.persisted.plants.find((plant) => plant.id === droppedPlant!.id)?.position)
        .toEqual({ x: 140, y: 100 })
      expect(store.persisted.plants).toHaveLength(2)
    } finally {
      focusSpy.mockRestore()
      controller.dispose()
      sourceControl.remove()
    }
  })

  it('does not show plant drop feedback for protected ordinary text drags', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    const dataTransfer = {
      dropEffect: 'copy',
      types: ['text/plain'],
      getData() {
        return ''
      },
    }
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined

    container.dispatchEvent(dragOverEvent)

    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('none')
    expect(preview?.style.display).toBe('none')
    controller.dispose()
  })

  it('does not create plant placements from drag-and-drop payloads on a locked Plants Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'plants' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    const dragData = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      setData(type: string, value: string) {
        dragData.set(type, value)
      },
      getData(type: string) {
        return dragData.get(type) ?? ''
      },
    }
    writePlantStampDragData(dataTransfer, {
      canonical_name: 'Pyrus communis',
      common_name: 'Pear',
      stratum: 'mid',
      width_max_m: 3,
    })

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined

    ;(controller as any)._onDragOver(dragOverEvent)
    ;(controller as any)._onDrop(dropEvent)

    expect(store.persisted.plants).toHaveLength(0)
    expect(preview?.style.display).toBe('none')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('selects annotations before overlapping zones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'zone-1',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
          { x: 110, y: 80 },
          { x: 10, y: 80 },
        ],
        fillColor: null,
        notes: null,
      }]
      draft.annotations = [{
        kind: 'annotation',
        locked: false,
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 20, y: 20 },
        text: 'Top note',
        fontSize: 16,
        rotationDeg: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 24, y: 24 }, { button: 0 })
    events.pointerUp({ x: 24, y: 24 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['annotation-1']))
    expect(deps.setSelection).toHaveBeenCalledWith(new Set(['annotation-1']))
    controller.dispose()
  })

  it('clears selection through the runtime seam when clicking empty canvas', () => {
    selectedObjectIds.value = new Set(['plant-1'])
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 380, y: 280 }, { button: 0 })
    events.pointerUp({ x: 380, y: 280 }, { button: 0 })

    expect(selectedObjectIds.value.size).toBe(0)
    expect(deps.clearSelection).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('temporarily pans with the space key while select is active', () => {
    const render = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.holdSpace()
    events.pointerDown({ x: 100, y: 100 })
    events.pointerMove({ x: 130, y: 120 })
    events.pointerUp({ x: 130, y: 120 })
    events.releaseSpace()

    expect(camera.viewport.x).toBe(30)
    expect(camera.viewport.y).toBe(20)
    expect(render).toHaveBeenCalled()
    controller.dispose()
  })

  it('clears hover when disposed', () => {
    const setHoveredEntityId = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setHoveredEntityId })
    const controller = new SceneInteractionController(deps as any)

    controller.dispose()

    expect(setHoveredEntityId).toHaveBeenCalledWith(null)
  })
})
