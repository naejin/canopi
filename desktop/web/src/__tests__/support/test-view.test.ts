import { describe, expect, it } from 'vitest'
import { CameraController } from '../../canvas/runtime/camera'
import { planarCameraOf } from '../../canvas/runtime/view/view-transform'
import type { ViewFrame } from '../../canvas/runtime/view/types'
import { createTestView } from './test-view'

describe('createTestView', () => {
  it('setViewport at bearing 0 places world points as CameraController did', () => {
    const view = createTestView()
    const camera = new CameraController()
    camera.initialize({ width: 400, height: 300 })
    const worldPoints = [{ x: 0, y: 0 }, { x: 20, y: 30 }, { x: -12.5, y: 7.25 }, { x: 1e4, y: -3e3 }]
    const screenPoints = [{ x: 0, y: 0 }, { x: 140, y: 110 }, { x: 400, y: 300 }, { x: 33.3, y: -8 }]

    for (const viewport of [{ x: 0, y: 0, scale: 1 }, { x: 100, y: 50, scale: 2 }, { x: -3.75, y: 12.5, scale: 1 / 3 }, { x: 1e4, y: -2e3, scale: 1500 }]) {
      view.setViewport(viewport)
      camera.setViewport(viewport)

      expect(planarCameraOf(view.view())).toEqual({ ...camera.viewport, bearingDeg: 0 })
      for (const point of worldPoints) expect(view.view().worldToScreen(point)).toEqual(camera.worldToScreen(point))
      for (const point of screenPoints) expect(view.view().screenToWorld(point)).toEqual(camera.screenToWorld(point))
    }
    expect(view.view().screen).toEqual({ width: 400, height: 300, devicePixelRatio: 1 })
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
