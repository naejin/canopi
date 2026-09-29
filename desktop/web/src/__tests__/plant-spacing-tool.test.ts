import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore, type ScenePlantEntity, type ScenePoint } from '../canvas/runtime/scene'
import { SceneHistory } from '../canvas/runtime/scene-history'
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
    history: new SceneHistory(),
    setSelection: (ids) => store.setSelection(ids),
    incrementSceneRevision: () => {},
    syncCanvasSignalsFromScene: () => {},
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
    sceneEdits?: SceneRuntimeEditCoordinator
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
    sceneEdits: options.sceneEdits ?? createSceneEdits(store),
    switchTool: () => {},
    focusHost: () => {},
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

    expect(adapter.describeGuidance?.().plantRow).toMatchObject({ phase: 'row', interval: '1.25 m', intervalValid: true })

    adapter.spacingField!.input('0.75m')
    adapter.spacingField!.commit('0.75m')

    expect(commitPlantSpacingIntervalMeters).toHaveBeenCalledWith(0.75)
    expect(adapterInterval).toBe(0.75)
    expect(adapter.describeGuidance?.().plantRow).toMatchObject({ phase: 'row', interval: '75 cm', intervalValid: true })
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()

    adapter.dispose?.()
  })

  it('lays a row from the picked plant after the session plane re-origins', () => {
    store.updatePersisted((draft) => {
      draft.plants = [plantFixture()]
    })
    const sceneEdits = createSceneEdits(store)
    const adapter = createPlantSpacingAdapter(container, store, camera, {
      readPlantSpacingIntervalMeters: () => 1,
      commitPlantSpacingIntervalMeters: () => {},
      sceneEdits,
    })

    adapter.onActivate?.()
    dispatchPointerDown(adapter, events, camera, { x: 20, y: 30 })
    expect(adapter.describeGuidance?.().plantRow).toMatchObject({ phase: 'row' })

    const previous = store.sessionPlane
    const transform = sceneEdits.reoriginSessionPlane(previous.toGeo({ x: 12_000, y: 3_000 }))!
    camera.reprojectViewport(transform)
    const source = store.persisted.plants[0]!.position
    expect(source.x).not.toBeCloseTo(20, 3)

    // An endpoint five metres east of the picked plant, in the new plane.
    const end = camera.worldToScreen({ x: source.x + 5, y: source.y })
    dispatchPointerDown(adapter, events, camera, end)

    const added = store.persisted.plants.slice(1)
    expect(added.length).toBeGreaterThan(0)
    for (const plant of added) {
      expect(plant.position.y).toBeCloseTo(source.y, 3)
      expect(plant.position.x).toBeGreaterThan(source.x)
      expect(plant.position.x).toBeLessThanOrEqual(source.x + 5 + 1e-3)
    }
    adapter.dispose?.()
  })
})
