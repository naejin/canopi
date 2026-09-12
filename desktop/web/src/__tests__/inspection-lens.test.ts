import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraController } from '../canvas/runtime/camera'
import { SceneCanvasInspectionOwner } from '../canvas/runtime/inspection-lens'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('Inspection Lens ownership', () => {
  it('inspects the pointer position in canvas coordinates without editing the scene or camera', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    camera.setViewport({ x: 100, y: 50, scale: 10 })
    const snapshot = createTestSceneRendererSnapshot()
    const before = JSON.stringify(snapshot.scene)
    const owner = new SceneCanvasInspectionOwner({ camera, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => snapshot, setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))
    view.inspectAtScreenPoint({ x: 250, y: 180 })
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: 15, y: 13 })
    expect(camera.snapshot.peek().viewport).toEqual({ x: 100, y: 50, scale: 10 })
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    view.inspectAtScreenPoint({ x: Number.NaN, y: 100 })
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: 15, y: 13 })
    owner.dispose()
    view.inspectAtScreenPoint({ x: 0, y: 0 })
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
  })

  it('keeps its inspected location when the main camera moves', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const owner = new SceneCanvasInspectionOwner({ camera,
      revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => createTestSceneRendererSnapshot(), setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))
    vi.advanceTimersByTime(20)
    const point = view.state.value!.point
    camera.panBy({ x: 120, y: 80 })
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual(point)
    owner.dispose()
  })

  it('recenters explicitly and resets the inspected location with the document', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const owner = new SceneCanvasInspectionOwner({ camera,
      revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => createTestSceneRendererSnapshot(), setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))
    vi.advanceTimersByTime(20)
    camera.setViewport({ x: 100, y: 50, scale: 10 })
    view.centerOnCanvas()
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: 30, y: 25 })
    view.panBy({ x: 4, y: 2 })
    view.zoomBy(2)
    vi.advanceTimersByTime(20)
    owner.reset()
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: 30, y: 25 })
    expect(view.state.value!.zoomPercent).toBe(700)
    owner.dispose()
    view.centerOnCanvas()
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
  })

  it('clears identification and hover when the Plants Layer becomes hidden', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    let snapshot = createTestSceneRendererSnapshot({ scene: { layers: [{ kind: 'layer', name: 'plants', visible: true, opacity: 1, locked: false }], plants: [{
      kind: 'plant', id: 'mint', canonicalName: 'Mentha spicata', commonName: 'Menthe verte', position: { x: 0, y: 0 },
      color: null, stratum: null, canopySpreadM: null, rotationDeg: null, scale: null, notes: null,
      plantedDate: null, quantity: null, locked: false,
    }] } })
    const revision = { scene: signal(0), plantNames: signal(0) }, setHoveredTarget = vi.fn(target => { snapshot = { ...snapshot, hoverTarget: target } })
    const owner = new SceneCanvasInspectionOwner({ camera: new CameraController(), revision, getSnapshot: () => snapshot, setHoveredTarget })
    const view = owner.mount(document.createElement('div'))
    view.panBy({ x: 0, y: 0 }); vi.advanceTimersByTime(20)
    view.highlightPlant('mint'); vi.advanceTimersByTime(20)
    snapshot = { ...snapshot, scene: { ...snapshot.scene, layers: snapshot.scene.layers.map(layer => layer.name === 'plants' ? { ...layer, visible: false } : layer) } }
    revision.scene.value++; vi.advanceTimersByTime(20)
    expect(view.state.value?.plants).toEqual([])
    expect(setHoveredTarget).toHaveBeenLastCalledWith(null)
    owner.dispose()
  })
  it('lays out dense plant names inside the inspection frame without overlaps', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const snapshot = createTestSceneRendererSnapshot({ scene: { plants: Array.from({ length: 12 }, (_, i) => ({
      kind: 'plant', id: String(i), canonicalName: 'Mentha spicata', commonName: 'Menthe verte',
      position: { x: (i % 4) * .2, y: Math.floor(i / 4) * .2 }, color: null, stratum: null,
      canopySpreadM: null, rotationDeg: null, scale: null, notes: null, plantedDate: null, quantity: null, locked: false,
    })) } })
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const owner = new SceneCanvasInspectionOwner({ camera, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => snapshot, setHoveredTarget() {} })
    const container = document.createElement('div')
    Object.defineProperties(container, { clientWidth: { value: 430 }, clientHeight: { value: 390 } })
    const view = owner.mount(container)
    view.panBy({ x: -49.7, y: -49.8 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.frame).toEqual({ width: 430, height: 390 })
    expect(view.state.value!.zoomPercent).toBeGreaterThan(700)
    const boxes = view.state.value!.plants.flatMap(plant => plant.label ? [plant.label] : [])
    expect(boxes.length).toBeGreaterThan(4)
    for (const [i, box] of boxes.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(430)
      expect(box.y + box.height).toBeLessThanOrEqual(390)
      for (const other of boxes.slice(i + 1)) expect(box.x < other.x + other.width && box.x + box.width > other.x
        && box.y < other.y + other.height && box.y + box.height > other.y).toBe(false)
    }
    owner.dispose()
  })
  it('pans only the inspection view, ignoring invalid or released movement', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const snapshot = createTestSceneRendererSnapshot()
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const viewport = { ...camera.snapshot.peek().viewport }
    const owner = new SceneCanvasInspectionOwner({ camera, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => snapshot, setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))
    view.panBy({ x: -49, y: -48 })
    vi.advanceTimersByTime(20)
    view.panBy({ x: 2, y: -1 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.point).toEqual({ x: 3, y: 1 })
    view.panBy({ x: Number.NaN, y: 0 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.point).toEqual({ x: 3, y: 1 })
    expect(view.state.value?.scale).toBeGreaterThan(0)
    expect(camera.snapshot.peek().viewport).toEqual(viewport)
    owner.dispose()
    view.panBy({ x: 2, y: 2 })
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
  })

  it('rolls back its canvas and scheduled work if attachment fails', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      observe() { throw new Error('attachment failed') }
      disconnect = disconnect
    })
    const camera = new CameraController()
    const getSnapshot = vi.fn(() => createTestSceneRendererSnapshot())
    const owner = new SceneCanvasInspectionOwner({ camera, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot, setHoveredTarget() {} })
    const container = document.createElement('div')
    try {
      expect(() => owner.mount(container)).toThrow('attachment failed')
      expect(container.childElementCount).toBe(0)
      expect(disconnect).toHaveBeenCalled()
      vi.advanceTimersByTime(20)
      expect(getSnapshot).not.toHaveBeenCalled()
    } finally { owner.dispose(); vi.unstubAllGlobals() }
  })

  it('identifies nearby plants and keeps its location without changing the Design', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const snapshot = createTestSceneRendererSnapshot({ scene: { plants: [{
      kind: 'plant', id: 'mint', canonicalName: 'Mentha spicata', commonName: 'Menthe verte', position: { x: 1, y: 2 },
      color: null, stratum: null, canopySpreadM: null, rotationDeg: null, scale: null, notes: null,
      plantedDate: null, quantity: null, locked: false,
    }] } })
    const before = JSON.stringify(snapshot.scene)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const owner = new SceneCanvasInspectionOwner({ camera, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => snapshot, setHoveredTarget() {} })
    const container = document.createElement('div')
    const view = owner.mount(container)
    view.panBy({ x: -49, y: -48 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.plants.map((plant) => plant.name)).toEqual(['Menthe verte'])
    camera.panBy({ x: 5, y: 6 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.point).toEqual({ x: 1, y: 2 })
    const viewport = { ...camera.snapshot.peek().viewport }
    const lensZoom = view.state.value!.zoomPercent
    view.zoomBy(1.25)
    vi.advanceTimersByTime(20)
    expect(view.state.value!.zoomPercent).toBeGreaterThan(lensZoom)
    expect(camera.snapshot.peek().viewport).toEqual(viewport)
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    const scale = camera.snapshot.peek().viewport.scale
    view.focusPlant('mint')
    vi.advanceTimersByTime(20)
    expect(camera.snapshot.peek().viewport.scale).toBe(scale)
    expect(camera.snapshot.peek().viewport).toEqual(viewport)
    expect(view.state.value?.point).toEqual({ x: 1, y: 2 })
    owner.reset()
    vi.advanceTimersByTime(20)
    expect(view.state.value?.zoomPercent).toBe(700)
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    owner.dispose()
    expect(container.querySelector('canvas')).toBeNull()
    view.panBy({ x: 5, y: 6 })
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
    view.dispose()
  })
})
