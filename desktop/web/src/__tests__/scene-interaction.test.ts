import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPlantStampSource,
  readPlantStampSource,
  selectPlantStampSource,
  writePlantStampDragData,
} from '../canvas/plant-stamp-source'
import { guides } from '../canvas/scene-metadata-state'
import { selectedObjectIds } from '../canvas/session-state'
import { snapToGridEnabled, snapToGuidesEnabled } from '../app/canvas-settings/signals'
import { plantSpacingIntervalM } from '../app/settings/state'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore } from '../canvas/runtime/scene'
import { SceneInteractionController, type SceneInteractionDeps } from '../canvas/runtime/scene-interaction'
import { SceneRuntimeEditCoordinator } from '../canvas/runtime/scene-runtime/transactions'
import {
  CANVAS_NOTICE_MARGIN_PX,
  CANVAS_RULER_SIZE_PX,
} from '../canvas/canvas-notice-layout'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
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

  it('does not select or drag locked Design Objects from SceneStore', () => {
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

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 35, y: 45 }, { button: 0 })
    events.pointerUp({ x: 35, y: 45 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set())
    expect(store.persisted.plants[0]?.position).toEqual({ x: 20, y: 30 })
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
        layer: 'plants',
        position: { x: 20, y: 30 },
        rotationDeg: null,
        memberIds: ['locked-member'],
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
        layer: 'plants',
        position: { x: 20, y: 30 },
        rotationDeg: null,
        memberIds: ['grouped-plant'],
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
      points: [
        { x: 40, y: 60 },
        { x: 30, y: 40 },
      ],
    })
    expect(store.toCanopiFile().zones[0]).toMatchObject({
      zone_type: 'ellipse',
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

  it('normalizes elliptical zone drags in any direction', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('ellipse')

    events.pointerDown({ x: 110, y: 90 }, { button: 0 })
    events.pointerMove({ x: 10, y: 10 }, { button: 0 })
    events.pointerUp({ x: 10, y: 10 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'ellipse',
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

    events.pointerDown({ x: 50, y: 60 }, { button: 0 })
    events.pointerUp({ x: 50, y: 60 }, { button: 0 })

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

    events.pointerDown({ x: 50, y: 60 }, { button: 0 })
    events.pointerUp({ x: 50, y: 60 }, { button: 0 })
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    events.pointerDown({ x: 150, y: 60 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 150, y: 60 }, { button: 0 })

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

    events.pointerDown({ x: 50, y: 50 }, { button: 0 })
    events.pointerUp({ x: 50, y: 50 }, { button: 0 })

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

    events.pointerDown({ x: 50, y: 50 }, { button: 0 })
    events.pointerMove({ x: 60, y: 65 }, { button: 0 })
    events.pointerUp({ x: 60, y: 65 }, { button: 0 })

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
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
      ],
    })
    expect(store.toCanopiFile().zones[0]).toMatchObject({
      zone_type: 'polygon',
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

    events.pointerDown({ x: 40, y: 20 }, { button: 0 })
    events.pointerUp({ x: 40, y: 20 }, { button: 0 })

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

    events.pointerDown({ x: 40, y: 20 }, { button: 0 })
    events.pointerUp({ x: 40, y: 20 }, { button: 0 })
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    events.pointerDown({ x: 130, y: 20 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 130, y: 20 }, { button: 0 })

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

    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    events.pointerUp({ x: 20, y: 20 }, { button: 0 })

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

    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    events.pointerUp({ x: 20, y: 20 }, { button: 0 })
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    events.pointerDown({ x: 160, y: 20 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 160, y: 20 }, { button: 0 })

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
        layer: 'zones',
        position: { x: 0, y: 0 },
        rotationDeg: null,
        memberIds: ['zone-1'],
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    events.pointerUp({ x: 20, y: 20 }, { button: 0 })

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

    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    events.pointerUp({ x: 20, y: 20 }, { button: 0 })

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

  it('places plant-stamp plants using species default color', () => {
    store.updatePersisted((draft) => {
      draft.plantSpeciesColors = {
        'Malus domestica': '#C44230',
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
      position: { x: 50, y: 70 },
    })
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
      draft.plants = [{
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
      }]
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
    events.pointerUp({ x: 232, y: 248 }, { button: 0 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 60, y: 60 })
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

  it('samples a placed plant with Object Stamp and places anchored clones', () => {
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

    events.pointerDown({ x: 25, y: 30 }, { button: 0 })
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
      points: [
        { x: 105, y: 140 },
        { x: 145, y: 140 },
        { x: 145, y: 180 },
        { x: 105, y: 180 },
      ],
      fillColor: '#A06B1F',
      notes: 'Annuals',
    })
    expect(selectedObjectIds.value).toEqual(new Set(['Kitchen bed copy 2']))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
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

    events.pointerDown({ x: 50, y: 60 }, { button: 0 })
    events.pointerDown({ x: 100, y: 100 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(2)
    expect(store.persisted.zones[1]).toMatchObject({
      name: 'Oval bed copy',
      zoneType: 'ellipse',
      points: [
        { x: 100, y: 100 },
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
        layer: 'plants',
        position: { x: 10, y: 20 },
        rotationDeg: 5,
        memberIds: ['plant-1', 'Kitchen bed', 'annotation-1'],
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
      layer: 'plants',
      position: { x: 70, y: 100 },
      rotationDeg: 5,
      memberIds: [clonePlant.id, cloneZone.name, cloneAnnotation.id],
    })
    expect(cloneGroup.id).not.toBe('group-1')
    expect(store.persisted.groups[0]?.memberIds).toEqual(['plant-1', 'Kitchen bed', 'annotation-1'])
    expect(selectedObjectIds.value).toEqual(new Set([cloneGroup.id]))
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-object-stamp')
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
        layer: 'plants',
        position: { x: 38, y: 38 },
        rotationDeg: null,
        memberIds: ['plant-1'],
        locked: false,
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
        layer: 'plants',
        position: { x: 38, y: 38 },
        rotationDeg: null,
        memberIds: ['plant-1'],
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

  it('creates plant placements from drag-and-drop payloads', () => {
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
    expect(preview?.style.display).toBe('block')
    ;(controller as any)._onDrop(dropEvent)

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

  it('selects annotations before overlapping zones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        name: 'zone-1',
        zoneType: 'rect',
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
