import { describe, expect, it } from 'vitest'
import { planarCameraOf } from '../../canvas/runtime/view/view-transform'
import type { ViewFrame } from '../../canvas/runtime/view/types'
import { createTestView } from './test-view'

describe('createTestView', () => {
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

  it('legacyCamera and view() read the same host', () => {
    const view = createTestView({ viewport: { x: 12, y: -4, scale: 2 } })
    const camera = view.legacyCamera
    const readsAgree = () => {
      const placement = planarCameraOf(view.view())
      expect(camera.viewport).toEqual({ x: placement.x, y: placement.y, scale: placement.scale })
      expect(camera.snapshot.peek().viewport).toEqual(camera.viewport)
      expect(camera.screenSize).toEqual({ width: view.view().screen.width, height: view.view().screen.height })
      for (const point of [{ x: 0, y: 0 }, { x: 20, y: 30 }, { x: -7.5, y: 3.25 }]) {
        expect(camera.worldToScreen(point)).toEqual(view.view().worldToScreen(point))
        expect(camera.screenToWorld(point)).toEqual(view.view().screenToWorld(point))
      }
    }
    readsAgree()

    // Moves through either side land on the one host.
    camera.panBy({ x: 30, y: -10 })
    readsAgree()
    expect(camera.viewport).toEqual({ x: 42, y: -14, scale: 2 })
    view.setViewport({ x: -5, y: 8, scale: 4 })
    readsAgree()
    view.navigation.zoomIn()
    readsAgree()
    camera.zoomAroundScreenPoint({ x: 140, y: 110 }, 0.5)
    readsAgree()
    expect(camera.snapshot.peek().mode).toBe(view.frames.viewFrame.peek().mode)
    view.dispose()
  })

  it('advance runs due frames and the settle timer', () => {
    const view = createTestView()
    const published: ViewFrame[] = []
    view.frames.onViewFrame('tools', (frame) => published.push(frame))
    const settled = view.frames.settledViewFrame.peek()

    view.navigation.rotateBy(1)
    expect(published).toHaveLength(1)
    expect(view.clock.now()).toBe(0)

    // The tween's first animation frame runs at the end of the next advance, before the timers.
    view.clock.advance(100)
    expect(published).toHaveLength(2)
    expect(view.frames.settledViewFrame.peek()).toBe(settled)

    view.clock.advance(200)
    expect(published).toHaveLength(3)
    expect(published[2]!.view.camera.bearingDeg).toBe(15)
    expect(view.frames.settledViewFrame.peek()).toBe(settled)

    // 150 ms after the last frame the settle timer publishes it as the settled frame.
    view.clock.advance(149)
    expect(view.frames.settledViewFrame.peek()).toBe(settled)
    view.clock.advance(1)
    expect(view.frames.settledViewFrame.peek()).toBe(published[2])
    expect(view.clock.now()).toBe(450)
    view.dispose()
  })
})
