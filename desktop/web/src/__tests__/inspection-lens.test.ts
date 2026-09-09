import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraController } from '../canvas/runtime/camera'
import { SceneCanvasInspectionOwner } from '../canvas/runtime/inspection-lens'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('Inspection Lens ownership', () => {
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
      getSnapshot, setHoveredTarget() {}, invalidateViewport() {} })
    const container = document.createElement('div')
    try {
      expect(() => owner.mount(container)).toThrow('attachment failed')
      expect(container.childElementCount).toBe(0)
      expect(disconnect).toHaveBeenCalled()
      vi.advanceTimersByTime(20)
      expect(getSnapshot).not.toHaveBeenCalled()
    } finally { owner.dispose(); vi.unstubAllGlobals() }
  })

  it('identifies nearby plants and holds its location without changing the Design', () => {
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
      getSnapshot: () => snapshot, setHoveredTarget() {}, invalidateViewport() {} })
    const container = document.createElement('div')
    const view = owner.mount(container)
    view.inspect({ x: 1, y: 2 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.plants.map((plant) => plant.name)).toEqual(['Menthe verte'])
    view.setHeld(true)
    view.inspect({ x: 5, y: 6 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.point).toEqual({ x: 1, y: 2 })
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    const scale = camera.snapshot.peek().viewport.scale
    view.focusPlant('mint')
    vi.advanceTimersByTime(20)
    expect(camera.snapshot.peek().viewport.scale).toBe(scale)
    expect(camera.worldToScreen({ x: 1, y: 2 })).toEqual({ x: 400, y: 300 })
    owner.reset()
    vi.advanceTimersByTime(20)
    expect(view.state.value?.held).toBe(false)
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    owner.dispose()
    expect(container.querySelector('canvas')).toBeNull()
    view.inspect({ x: 5, y: 6 })
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
    view.dispose()
  })
})
