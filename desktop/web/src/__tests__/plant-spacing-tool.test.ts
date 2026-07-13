import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore, type ScenePlantEntity, type ScenePoint } from '../canvas/runtime/scene'
import { SceneRuntimeEditCoordinator } from '../canvas/runtime/scene-runtime/transactions'
import {
  createPlantSpacingTool,
  createPlantSpacingToolAdapter,
} from '../canvas/runtime/interaction/plant-spacing-tool'
import type { SceneToolAdapter } from '../canvas/runtime/interaction/tool-adapter'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from './support/scene-interaction-events'

function createPlantPresentationContext(viewportScale: number) {
  return {
    viewport: { x: 0, y: 0, scale: viewportScale },
    speciesCache: new Map(),
  }
}

function createSceneEdits(store: SceneStore): SceneRuntimeEditCoordinator {
  return new SceneRuntimeEditCoordinator({
    sceneStore: store,
    captureSnapshot: () => {
      const snapshot = store.snapshot()
      return {
        persisted: snapshot.persisted,
        session: snapshot.session,
      }
    },
    markDirty: () => true,
    setSelection: (ids) => store.setSelection(ids),
    invalidate: () => {},
  })
}

function createPlantSpacingAdapter(
  container: HTMLElement,
  store: SceneStore,
  camera: CameraController,
  options: {
    readPlantSpacingIntervalMeters: () => number
    commitPlantSpacingIntervalMeters: (meters: number) => void
  },
): SceneToolAdapter {
  const tool = createPlantSpacingTool({
    container,
    camera,
    getSceneStore: () => store,
    getSpeciesCache: () => new Map(),
    getPlantPresentationContext: createPlantPresentationContext,
    getLocalizedCommonNames: () => new Map(),
    readPlantSpacingIntervalMeters: options.readPlantSpacingIntervalMeters,
    commitPlantSpacingIntervalMeters: options.commitPlantSpacingIntervalMeters,
    sceneEdits: createSceneEdits(store),
    switchTool: () => {},
    applySnapping: (point) => point,
    getContainerRect: () => container.getBoundingClientRect(),
  })
  return createPlantSpacingToolAdapter(tool)
}

function dispatchPointerDown(
  adapter: SceneToolAdapter,
  events: SceneInteractionEventHarness,
  camera: CameraController,
  screen: ScenePoint,
): void {
  const event = events.pointerDown(screen, { button: 0 })
  const handled = adapter.pointerDown?.({
    event,
    screen: events.screenPointFrom(event),
    rawWorld: events.worldPointFrom(camera, event),
    beginDrag: vi.fn(),
    clearPointerGesture: vi.fn(),
  })

  expect(handled).toBe(true)
}

function plantFixture(id = 'plant-1'): ScenePlantEntity {
  return {
    kind: 'plant',
    locked: false,
    id,
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
  }
}

describe('Plant Spacing tool adapter', () => {
  let container: HTMLDivElement
  let events: SceneInteractionEventHarness
  let camera: CameraController
  let store: SceneStore

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    events = createSceneInteractionEventHarness(container)
    camera = new CameraController()
    camera.initialize({ width: 400, height: 300 })
    camera.setViewport({ x: 0, y: 0, scale: 1 })
    store = new SceneStore()
  })

  afterEach(() => {
    events.dispose()
    container.remove()
  })

  it('reads and commits Plant Spacing interval through tool dependencies', () => {
    store.updatePersisted((draft) => {
      draft.plants = [plantFixture()]
    })
    let adapterInterval = 1.25
    const commitPlantSpacingIntervalMeters = vi.fn((meters: number) => {
      adapterInterval = meters
    })
    const adapter = createPlantSpacingAdapter(container, store, camera, {
      readPlantSpacingIntervalMeters: () => adapterInterval,
      commitPlantSpacingIntervalMeters,
    })

    adapter.onActivate?.()
    dispatchPointerDown(adapter, events, camera, { x: 20, y: 30 })

    const input = container.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]')!
    expect(input.value).toBe('1.25 m')

    input.value = '0.75m'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(commitPlantSpacingIntervalMeters).toHaveBeenCalledWith(0.75)
    expect(adapterInterval).toBe(0.75)
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()

    adapter.dispose?.()
  })
})
