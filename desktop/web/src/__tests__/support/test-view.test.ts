import { afterEach, describe, expect, it, vi } from 'vitest'
import { planarCameraOf } from '../../canvas/runtime/view/view-transform'
import type { ViewFrame } from '../../canvas/runtime/view/types'
import { createTestView } from './test-view'

describe('createTestView', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('setViewport at bearing 0 places world points within 1e-6 of CameraController', () => {
    const view = createTestView()
    const worldPoints = [{ x: 0, y: 0 }, { x: 20, y: 30 }, { x: -12.5, y: 7.25 }, { x: 1e4, y: -3e3 }]
    const screenPoints = [{ x: 0, y: 0 }, { x: 140, y: 110 }, { x: 400, y: 300 }, { x: 33.3, y: -8 }]

    for (const viewport of [{ x: 0, y: 0, scale: 1 }, { x: 100, y: 50, scale: 2 }, { x: -3.75, y: 12.5, scale: 1 / 3 }, { x: 1e4, y: -2e3, scale: 1500 }]) {
      view.setViewport(viewport)

      // Today's CameraController: setViewport adopted the placement, worldToScreen was p × scale + { x, y } and screenToWorld its
      // inverse (camera.ts:373-387 at 52cbff10). The placement is checked against the golden viewport within 1e-6; the
      // projections are self-consistent against the camera's own x/y/scale so that drift is not amplified by a large point.
      const camera = planarCameraOf(view.view())
      expect(camera.bearingDeg).toBe(0)
      expect(camera.x).toBeCloseTo(viewport.x, 6)
      expect(camera.y).toBeCloseTo(viewport.y, 6)
      expect(camera.scale).toBeCloseTo(viewport.scale, 6)
      for (const point of worldPoints) {
        expect(view.view().worldToScreen(point)).toEqual({ x: point.x * camera.scale + camera.x, y: point.y * camera.scale + camera.y })
      }
      for (const point of screenPoints) {
        expect(view.view().screenToWorld(point)).toEqual({ x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale })
      }
    }
    expect(view.view().screen).toEqual({ width: 400, height: 300, devicePixelRatio: 1 })
    view.dispose()
  })

  it('viewport() reads the placement setViewport made', () => {
    const view = createTestView({ camera: { bearingDeg: 30 } })
    for (const viewport of [{ x: 0, y: 0, scale: 1 }, { x: 100, y: 50, scale: 2 }, { x: -3.75, y: 12.5, scale: 1 / 3 }]) {
      view.setViewport(viewport)
      const read = view.viewport()
      expect(Object.keys(read).sort()).toEqual(['scale', 'x', 'y'])
      expect(read.x).toBeCloseTo(viewport.x, 6)
      expect(read.y).toBeCloseTo(viewport.y, 6)
      expect(read.scale).toBeCloseTo(viewport.scale, 6)
    }
    view.dispose()
  })

  it('reproject moves the placement as CameraController.reprojectViewport did', () => {
    const view = createTestView({ viewport: { x: 100, y: 50, scale: 2 } })
    const transform = { scale: 1.25, offsetX: -20, offsetY: 8 }
    const before = [{ x: 0, y: 0 }, { x: 20, y: 30 }, { x: -7.5, y: 3.25 }].map((point) => ({ point, screen: view.view().worldToScreen(point) }))

    view.reproject(transform)

    // Today's reprojectPlaneViewport: scale / s, and the offset at the new scale off the translation.
    const placement = view.viewport()
    expect(placement.scale).toBeCloseTo(1.6, 6)
    expect(placement.x).toBeCloseTo(132, 6)
    expect(placement.y).toBeCloseTo(37.2, 6)
    // A plane point p is p × s + o in the new terms, on the same pixel.
    for (const { point, screen } of before) {
      const moved = view.view().worldToScreen({ x: point.x * 1.25 - 20, y: point.y * 1.25 + 8 })
      expect(moved.x).toBeCloseTo(screen.x, 6)
      expect(moved.y).toBeCloseTo(screen.y, 6)
    }
    view.dispose()
  })

  it('a turn and the settle run on Vitest fake timers', () => {
    vi.useFakeTimers()
    const view = createTestView()
    const published: ViewFrame[] = []
    view.frames.onViewFrame('tools', (frame) => published.push(frame))
    const settled = view.frames.settledViewFrame.peek()

    view.navigation.rotateBy(1)
    expect(published).toHaveLength(1)

    // The tween lands on an animation frame; the settle has not run while it moved.
    vi.advanceTimersByTime(320)
    const landed = published.at(-1)!
    expect(landed.view.camera.bearingDeg).toBe(15)
    expect(landed.moving).toBe(false)
    expect(view.frames.settledViewFrame.peek()).toBe(settled)

    // 150 ms after the last frame the settle timer publishes it as the settled frame.
    vi.advanceTimersByTime(150)
    expect(view.frames.settledViewFrame.peek()).toBe(landed)
    view.dispose()
  })
})
