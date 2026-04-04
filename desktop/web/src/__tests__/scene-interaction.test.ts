import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gridSize, plantStampSpecies, selectedObjectIds, snapToGridEnabled } from '../state/canvas'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore } from '../canvas/runtime/scene'
import { SceneInteractionController, type SceneInteractionDeps } from '../canvas/runtime/scene-interaction'

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
  overrides: Partial<Pick<SceneInteractionDeps, 'render' | 'markDirty' | 'setTool'>> = {},
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

  return {
    container,
    getSceneStore: () => store,
    camera,
    getSpeciesCache: () => new Map(),
    getPlantPresentationContext: createPlantPresentationContext,
    getSelection: () => new Set(selection),
    setSelection,
    clearSelection,
    setTool: (overrides.setTool ?? ((name: string) => {
      void name
    })) as SceneInteractionDeps['setTool'],
    render: (overrides.render ?? (() => {})) as SceneInteractionDeps['render'],
    markDirty: (overrides.markDirty ?? (() => {})) as SceneInteractionDeps['markDirty'],
    setHoveredEntityId: () => {},
    getLocalizedCommonNames: () => new Map(),
  } as SceneInteractionDeps
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
    plantStampSpecies.value = null
    snapToGridEnabled.value = false
    gridSize.value = 1
  })

  afterEach(() => {
    container.remove()
    selectedObjectIds.value = new Set()
    plantStampSpecies.value = null
    snapToGridEnabled.value = false
    gridSize.value = 1
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
    const markDirty = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render, markDirty })
    const controller = new SceneInteractionController(deps as any)
    controller.setTool('select')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 20, clientY: 30, button: 0 }))
    ;(controller as any)._onPointerMove(new MouseEvent('pointermove', { clientX: 35, clientY: 45, button: 0 }))
    ;(controller as any)._onPointerUp(new MouseEvent('pointerup', { clientX: 35, clientY: 45, button: 0 }))

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(markDirty).toHaveBeenCalledTimes(1)
    expect(deps.setSelection).toHaveBeenCalledWith(new Set(['plant-1']))
    controller.dispose()
  })

  it('creates a rectangle zone from the rectangle tool drag', () => {
    const render = vi.fn()
    const markDirty = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render, markDirty })
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
    expect(markDirty).toHaveBeenCalledTimes(1)
    expect(deps.setSelection).toHaveBeenCalledTimes(1)
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

  it('snaps plant-stamp placement to the grid when snap is enabled', () => {
    snapToGridEnabled.value = true
    gridSize.value = 10
    plantStampSpecies.value = {
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    }

    const controller = new SceneInteractionController(createInteractionDeps(container, store, camera) as any)
    controller.setTool('plant-stamp')

    ;(controller as any)._onPointerDown(new MouseEvent('pointerdown', { clientX: 53, clientY: 67, button: 0 }))

    expect(store.persisted.plants[0]?.position).toEqual({ x: 50, y: 70 })
    controller.dispose()
  })

  it('creates plant placements from drag-and-drop payloads', () => {
    const markDirty = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { markDirty })
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
    expect(markDirty).toHaveBeenCalledTimes(1)
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
})
