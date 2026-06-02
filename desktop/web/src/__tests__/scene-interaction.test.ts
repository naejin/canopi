import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plantStampSpecies } from '../canvas/plant-tool-state'
import { lockedObjectIds } from '../canvas/runtime-mirror-state'
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
  overrides: Partial<Pick<SceneInteractionDeps, 'render' | 'sceneEdits' | 'setTool' | 'setHoveredEntityId' | 'setViewport'>>
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
        lockedIds: new Set(lockedObjectIds.value),
      }
    },
    markDirty: (_before, type) => {
      overrides.onSceneEditCommit?.(type ?? 'scene-mutation')
      return true
    },
    setSelection,
    setLockedIds: (ids) => {
      lockedObjectIds.value = new Set(ids)
    },
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
    getPlantPresentationContext: createPlantPresentationContext,
    getSelection: () => new Set(selection),
    setSelection,
    clearSelection,
    sceneEdits,
    setTool: (overrides.setTool ?? ((name: string) => {
      void name
    })) as SceneInteractionDeps['setTool'],
    render,
    setHoveredEntityId: overrides.setHoveredEntityId ?? (() => {}),
    getLocalizedCommonNames: () => new Map(),
  } as SceneInteractionDeps
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

describe('SceneInteractionController', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
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

    camera = new CameraController()
    camera.initialize({ width: 400, height: 300 })
    camera.setViewport({ x: 0, y: 0, scale: 1 })
    store = new SceneStore()
    selectedObjectIds.value = new Set()
    lockedObjectIds.value = new Set()
    plantStampSpecies.value = null
    snapToGridEnabled.value = false
    snapToGuidesEnabled.value = false
    guides.value = []
    plantSpacingIntervalM.value = 0.5
  })

  afterEach(() => {
    container.remove()
    selectedObjectIds.value = new Set()
    lockedObjectIds.value = new Set()
    plantStampSpecies.value = null
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 35, clientY: 45, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 35, clientY: 45, button: 0 }))

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    expect(deps.setSelection).toHaveBeenCalledWith(new Set(['plant-1']))
    controller.dispose()
  })

  it('shows Plant Spacing source picking and samples a plant without mutating selection', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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
    deps.setSelection(['already-selected'])
    vi.mocked(deps.setSelection).mockClear()
    const controller = new SceneInteractionController(deps as any)

    controller.setTool('plant-spacing')

    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')
    expect(hud?.textContent).toContain('Select a placed plant')
    expect(hud?.textContent).toContain('Esc to exit')
    expect(hud?.textContent).not.toContain('Plant Spacing')
    expect(hud?.querySelector('button')).toBeNull()

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 200, clientY: 200, button: 0 }))

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
        name: 'Grouped row',
        layer: 'plants',
        position: { x: 20, y: 30 },
        rotationDeg: null,
        memberIds: ['grouped-plant'],
      }]
    })
    lockedObjectIds.value = new Set(['locked-plant'])
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 80, clientY: 30, button: 0 }))
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'plants' ? { ...layer, visible: true, locked: true } : layer
      )
    })

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    controller.dispose()
  })

  it('clears Plant Spacing source state with Escape and exits when no source exists', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()

    ;(controller as any)._onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.dataset.state).toBe('source-picking')
    expect(setTool).not.toHaveBeenCalled()

    ;(controller as any)._onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(setTool).toHaveBeenCalledWith('select')
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.style.display).toBe('none')
    controller.dispose()
  })

  it('focuses Plant Spacing interval input after source sampling and accepts valid values with Enter', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')!
    expect(input.value).toBe('50 cm')
    expect(document.activeElement).toBe(input)

    input.value = '0,75m'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(hud.dataset.intervalValidity).toBe('valid')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(plantSpacingIntervalM.value).toBe(0.75)
    expect(store.persisted.plants).toHaveLength(1)
    expect(JSON.stringify(store.toCanopiFile())).not.toContain('plant_spacing_interval_m')
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    controller.dispose()
  })

  it('handles Escape from the focused Plant Spacing interval input', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    expect(document.activeElement).toBe(input)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.dataset.state).toBe('source-picking')
    controller.dispose()
  })

  it('ignores Plant Spacing HUD pointerdowns while editing the interval input', () => {
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
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 26, clientY: 30, button: 0 }))

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

  it('keeps Plant Spacing source alive for invalid interval input', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))

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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))

    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 26, clientY: 30, button: 0 }))

    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('6 m')
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(3)
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.textContent).toContain('3')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 26, clientY: 30, button: 0 }))

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

  it('caps dense Plant Spacing preview ghosts while keeping the generated count', () => {
    plantSpacingIntervalM.value = 0.001
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
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 22, clientY: 30, button: 0 }))

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-hud]')?.textContent).toContain('2000')
    const ghostCount = container.querySelectorAll('[data-plant-spacing-ghost]').length
    expect(ghostCount).toBeGreaterThan(0)
    expect(ghostCount).toBeLessThan(2000)
    controller.dispose()
  })

  it('keeps Plant Spacing preview active without a scene edit when no plants fit', () => {
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
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 21, clientY: 30, button: 0 }))

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('1 m')
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(0)

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 21, clientY: 30, button: 0 }))

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 40, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 51, clientY: 40, button: 0 }))

    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(2)

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 51, clientY: 40, button: 0 }))
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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', {
      clientX: 71,
      clientY: 52,
      button: 0,
      shiftKey: true,
    }))

    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(3)

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', {
      clientX: 71,
      clientY: 52,
      button: 0,
      shiftKey: true,
    }))
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.y)).toEqual([4, 4, 4])
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.x)).toEqual([5, 6, 7])
    controller.dispose()
  })

  it('clamps Plant Spacing endpoints outside the canvas to the visible edge', () => {
    plantSpacingIntervalM.value = 100
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
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 500, clientY: 30, button: 0 }))

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('380 m')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 500, clientY: 30, button: 0 }))
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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 26, clientY: 30, button: 0 }))
    const guide = container.querySelector<HTMLElement>('[data-plant-spacing-guide]')!
    const widthBefore = guide.style.width

    ;(controller as any)._onWheel(new WheelEvent('wheel', { clientX: 0, clientY: 0, deltaY: -120 }))

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('6 m')
    expect(guide.style.width).not.toBe(widthBefore)
    controller.dispose()
  })

  it('commits exactly 100 generated Plant Spacing plants without confirmation', () => {
    plantSpacingIntervalM.value = 1
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 110, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 110, clientY: 10, button: 0 }))

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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 111, clientY: 10, button: 0 }))

    const hud = container.querySelector<HTMLElement>('[data-plant-spacing-hud]')!
    const count = container.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')!
    expect(hud.textContent).toContain('101')
    expect(hud.textContent).not.toContain('Confirm')
    expect(container.querySelector('[data-plant-spacing-confirm]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-cancel-confirm]')).toBeNull()
    expect(count.dataset.density).toBe('dense')
    expect(count.style.color).toBe('var(--color-primary)')
    expect(count.style.fontWeight).toBe('600')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 111, clientY: 10, button: 0 }))

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(102)
    expect(store.persisted.plants[store.persisted.plants.length - 1]?.position).toEqual({ x: 111, y: 10 })
    controller.dispose()
  })

  it('commits Plant Spacing from click-hold drag without focusing the interval input mid-drag', () => {
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
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-spacing')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 26, clientY: 30, button: 0 }))
    expect(document.activeElement).not.toBe(input)
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 26, clientY: 30, button: 0 }))

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(4)
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 111, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 111, clientY: 10, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    input.value = '0'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 26, clientY: 30, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 26, clientY: 30, button: 0 }))

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

    ;(controller as any)._onWheel(new WheelEvent('wheel', { clientX: 200, clientY: 150, deltaY: -120 }))

    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledWith('viewport')
    controller.dispose()
  })

  it('creates a rectangle zone from the rectangle tool drag', () => {
    const render = vi.fn()
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render, onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('rectangle')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 40, clientY: 60, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 40, clientY: 60, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 70, clientY: 100, button: 0 }))

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.borderRadius).toBe('50%')

    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 70, clientY: 100, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 110, clientY: 90, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 10, clientY: 10, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 43, clientY: 87, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 148, clientY: 254, button: 0 }))

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('40px')
    expect(preview?.style.top).toBe('80px')
    expect(preview?.style.width).toBe('100px')
    expect(preview?.style.height).toBe('180px')
    expect(preview?.style.borderRadius).toBe('50%')

    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 148, clientY: 254, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 70, clientY: 100, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 50, clientY: 60, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 50, clientY: 60, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 50, clientY: 60, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 50, clientY: 60, button: 0 }))
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', {
      clientX: 150,
      clientY: 60,
      button: 0,
      shiftKey: true,
    }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 150, clientY: 60, button: 0 }))

    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('does not commit too-small elliptical zones', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('ellipse')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 10.2, clientY: 10.4, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 10.2, clientY: 10.4, button: 0 }))

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('selects elliptical zones through ellipse hit testing', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 50, clientY: 50, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 50, clientY: 50, button: 0 }))

    expect(selectedObjectIds.value).toEqual(new Set(['zone-ellipse']))
    expect(deps.setSelection).toHaveBeenCalledWith(new Set(['zone-ellipse']))
    controller.dispose()
  })

  it('moves elliptical zones without changing their radii', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 50, clientY: 50, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 60, clientY: 65, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 60, clientY: 65, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 60, clientY: 10, button: 0 }))

    const line = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(line?.getAttribute('points')).toBe('10,10 60,10')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 60, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 60, clientY: 50, button: 0 }))
    ;(controller as any)._onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 43, clientY: 87, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 148, clientY: 254, button: 0 }))

    const line = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(line?.getAttribute('points')).toBe('40,80 140,260')
    controller.dispose()
  })

  it('shows a live polygonal zone active-edge measurement while drawing', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 60, clientY: 10, button: 0 }))

    expect(zoneMeasurementTexts(container)).toEqual(['50 m'])
    controller.dispose()
  })

  it('clears existing selection when starting a polygonal zone draft', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))

    expect(selectedObjectIds.value.size).toBe(0)
    expect(deps.clearSelection).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('shows polygonal zone draft edge measurements, closing edge, and live area', () => {
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 60, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 60, clientY: 50, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 40, clientY: 20, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 40, clientY: 20, button: 0 }))
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', {
      clientX: 130,
      clientY: 20,
      button: 0,
      shiftKey: true,
    }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 130, clientY: 20, button: 0 }))

    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('does not select polygonal zones from empty bounding-box space', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 15, clientY: 45, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 15, clientY: 45, button: 0 }))

    expect(selectedObjectIds.value.size).toBe(0)
    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('closes a polygonal zone by clicking the first vertex', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 60, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 60, clientY: 50, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 12, clientY: 11, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 60, clientY: 10, button: 0 }))
    ;(controller as any)._onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 60, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 60, clientY: 50, button: 0 }))
    ;(controller as any)._onKeyDown(new KeyboardEvent('keydown', { key: 'Backspace' }))

    const line = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(line?.getAttribute('points')).toBe('10,10 60,50')
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('preserves polygonal zone drafts while space-panning the canvas', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 60, clientY: 10, button: 0 }))

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()

    ;(controller as any)._onKeyDown(new KeyboardEvent('keydown', { code: 'Space' }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 200, clientY: 150, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 220, clientY: 150, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 220, clientY: 150, button: 0 }))
    ;(controller as any)._onKeyUp(new KeyboardEvent('keyup', { code: 'Space' }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 60, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 200, clientY: 150, button: 1 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 220, clientY: 150, button: 1 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 220, clientY: 150, button: 1 }))

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('does not commit degenerate polygonal zones', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('polygon')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 60, clientY: 10, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 100, clientY: 10, button: 0 }))
    ;(controller as any)._onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 43, clientY: 87, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 148, clientY: 254, button: 0 }))

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('40px')
    expect(preview?.style.top).toBe('80px')
    expect(preview?.style.width).toBe('100px')
    expect(preview?.style.height).toBe('180px')

    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 148, clientY: 254, button: 0 }))

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
    guides.value = [
      { id: 'guide-v-start', axis: 'v', position: 12 },
      { id: 'guide-h-start', axis: 'h', position: 22 },
      { id: 'guide-v-end', axis: 'v', position: 36 },
      { id: 'guide-h-end', axis: 'h', position: 61 },
    ]

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('rectangle')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 49, clientY: 85, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 142, clientY: 243, button: 0 }))

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('48px')
    expect(preview?.style.top).toBe('88px')
    expect(preview?.style.width).toBe('96px')
    expect(preview?.style.height).toBe('156px')

    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 142, clientY: 243, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 70, clientY: 100, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 20, clientY: 20, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 20, clientY: 20, button: 0 }))
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', {
      clientX: 160,
      clientY: 20,
      button: 0,
      shiftKey: true,
    }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 160, clientY: 20, button: 0 }))

    expect(selectedObjectIds.value).toEqual(new Set(['zone-1', 'zone-2']))
    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('suppresses rectangle zone measurements for group selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 20, clientY: 20, button: 0 }))

    expect(selectedObjectIds.value).toEqual(new Set(['group-1']))
    expect(zoneMeasurementTexts(container)).toEqual([])
    controller.dispose()
  })

  it('hides short rectangle edge measurements while keeping the area visible', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 20, clientY: 20, button: 0 }))

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
    plantStampSpecies.value = {
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    }

    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('plant-stamp')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 50, clientY: 70, button: 0 }))

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#C44230',
      position: { x: 50, y: 70 },
    })
    controller.dispose()
  })

  it('creates tool objects when native randomUUID is unavailable', () => {
    withoutNativeRandomUUID(() => {
      let rectangleController: SceneInteractionController | null = null
      let plantController: SceneInteractionController | null = null

      try {
        rectangleController = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
        rectangleController.setTool('rectangle')

        ;(rectangleController as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 10, clientY: 20, button: 0 }))
        ;(rectangleController as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 40, clientY: 60, button: 0 }))
        ;(rectangleController as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 40, clientY: 60, button: 0 }))

        expect(store.persisted.zones).toHaveLength(1)

        plantStampSpecies.value = {
          canonical_name: 'Malus domestica',
          common_name: 'Apple',
          stratum: 'high',
          width_max_m: 4,
        }
        plantController = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
        plantController.setTool('plant-stamp')

        ;(plantController as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 50, clientY: 70, button: 0 }))

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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 201, clientY: 202, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 232, clientY: 248, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 232, clientY: 248, button: 0 }))

    expect(store.persisted.plants[0]?.position).toEqual({ x: 60, y: 60 })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    controller.dispose()
  })

  it('snaps plant-stamp placement to the grid when snap is enabled', () => {
    // At scale=4, gridInterval() returns 5m
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    plantStampSpecies.value = {
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    }

    const controller = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
    controller.setTool('plant-stamp')

    // Screen (53,67) → world (13.25, 16.75) → snaps to (15, 15) at 5m interval
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 53, clientY: 67, button: 0 }))

    expect(store.persisted.plants[0]?.position).toEqual({ x: 15, y: 15 })
    controller.dispose()
  })

  it('samples a placed plant with Object Stamp and places anchored clones', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 54, clientY: 63, button: 0 }))
    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 100, clientY: 120, button: 0 }))
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 100, clientY: 120, button: 0 }))

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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 44, clientY: 44, button: 0 }))
    // Screen (93, 107) -> world (23.25, 26.75), snapped to (25, 25) at this zoom level.
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 93, clientY: 107, button: 0 }))

    expect(store.persisted.plants[1]?.position).toEqual({ x: 24, y: 24 })
    controller.dispose()
  })

  it('clears loaded Object Stamp source and returns to select on Escape', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0 }))
    ;(controller as any)._onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 90, clientY: 90, button: 0 }))

    expect(setTool).toHaveBeenCalledWith('select')
    expect(store.persisted.plants).toHaveLength(1)
    controller.dispose()
  })

  it('clears loaded Object Stamp source when changing tools', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0 }))
    controller.setTool('select')
    controller.setTool('object-stamp')
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 90, clientY: 90, button: 0 }))

    expect(store.persisted.plants).toHaveLength(1)
    controller.dispose()
  })

  it('blocks Object Stamp sampling and placement for locked or hidden plant sources', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    lockedObjectIds.value = new Set(['plant-1'])
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 90, clientY: 90, button: 0 }))
    expect(store.persisted.plants).toHaveLength(1)

    lockedObjectIds.value = new Set()
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0 }))
    store.updatePersisted((draft) => {
      const plantsLayer = draft.layers.find((layer) => layer.name === 'plants')
      if (plantsLayer) plantsLayer.visible = false
    })
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 90, clientY: 90, button: 0 }))

    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('samples a zone with Object Stamp and places anchored collision-safe clones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        {
          kind: 'zone',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 25, clientY: 30, button: 0 }))
    expect(store.persisted.zones).toHaveLength(2)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 120, clientY: 150, button: 0 }))
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 120, clientY: 150, button: 0 }))

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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 30, clientY: 40, button: 0 }))
    expect(store.persisted.annotations).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 100, clientY: 110, button: 0 }))
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 100, clientY: 110, button: 0 }))

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
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 44, clientY: 44, button: 0 }))
    // Screen (93, 107) -> world (23.25, 26.75), snapped to (25, 25) at this zoom level.
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 93, clientY: 107, button: 0 }))

    expect(store.persisted.annotations[1]?.position).toEqual({ x: 24, y: 24 })
    controller.dispose()
  })

  it('preserves elliptical zone radii when stamping zones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 50, clientY: 60, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }))

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
      }]
      draft.annotations = [{
        kind: 'annotation',
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 100, y: 30 },
        text: 'Note',
        fontSize: 20,
        rotationDeg: null,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('object-stamp')

    lockedObjectIds.value = new Set(['Kitchen bed'])
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 120, clientY: 120, button: 0 }))
    expect(store.persisted.zones).toHaveLength(1)

    lockedObjectIds.value = new Set()
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, button: 0 }))
    store.updatePersisted((draft) => {
      const zonesLayer = draft.layers.find((layer) => layer.name === 'zones')
      if (zonesLayer) zonesLayer.visible = false
    })
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 120, clientY: 120, button: 0 }))
    expect(store.persisted.zones).toHaveLength(1)

    controller.setTool('select')
    controller.setTool('object-stamp')
    store.updatePersisted((draft) => {
      const zonesLayer = draft.layers.find((layer) => layer.name === 'zones')
      if (zonesLayer) zonesLayer.visible = true
    })

    lockedObjectIds.value = new Set(['annotation-1'])
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 104, clientY: 34, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 150, clientY: 90, button: 0 }))
    expect(store.persisted.annotations).toHaveLength(1)

    lockedObjectIds.value = new Set()
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 104, clientY: 34, button: 0 }))
    store.updatePersisted((draft) => {
      const annotationsLayer = draft.layers.find((layer) => layer.name === 'annotations')
      if (annotationsLayer) annotationsLayer.locked = true
    })
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 150, clientY: 90, button: 0 }))

    expect(store.persisted.annotations).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('samples an object group with Object Stamp and places cloned members with remapped group membership', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
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
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 60, y: 30 },
        text: 'Guild',
        fontSize: 20,
        rotationDeg: 10,
      }]
      draft.groups = [{
        kind: 'group',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 100, clientY: 120, button: 0 }))
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.display).toBe('block')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 100, clientY: 120, button: 0 }))

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
      }]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
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

    lockedObjectIds.value = new Set(['group-1'])
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0 }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 120, clientY: 120, button: 0 }))
    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)

    lockedObjectIds.value = new Set()
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, button: 0 }))
    store.updatePersisted((draft) => {
      const plantsLayer = draft.layers.find((layer) => layer.name === 'plants')
      if (plantsLayer) plantsLayer.locked = true
    })
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 120, clientY: 120, button: 0 }))

    expect(store.persisted.groups).toHaveLength(1)
    expect(store.persisted.plants).toHaveLength(1)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('creates plant placements from drag-and-drop payloads', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const controller = new SceneInteractionController(deps as any)

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: {
          getData: () => JSON.stringify({
            canonical_name: 'Pyrus communis',
            common_name: 'Pear',
            stratum: 'mid',
            width_max_m: 3,
          }),
        },
      },
    })

    ;(controller as any)._onDrop(dropEvent)

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Pyrus communis',
      commonName: 'Pear',
      position: { x: 80, y: 90 },
      scale: 3,
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drop')
    controller.dispose()
  })

  it('selects annotations before overlapping zones', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
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

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 24, clientY: 24, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 24, clientY: 24, button: 0 }))

    expect(selectedObjectIds.value).toEqual(new Set(['annotation-1']))
    expect(deps.setSelection).toHaveBeenCalledWith(new Set(['annotation-1']))
    controller.dispose()
  })

  it('clears selection through the runtime seam when clicking empty canvas', () => {
    selectedObjectIds.value = new Set(['plant-1'])
    const deps = createInteractionDeps(container, store, camera)
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 380, clientY: 280, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 380, clientY: 280, button: 0 }))

    expect(selectedObjectIds.value.size).toBe(0)
    expect(deps.clearSelection).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('temporarily pans with the space key while select is active', () => {
    const render = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 130, clientY: 120, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 130, clientY: 120, button: 0 }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }))

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
