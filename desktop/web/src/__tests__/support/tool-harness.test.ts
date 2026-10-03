import { describe, expect, it } from 'vitest'

import { createToolHarness } from './tool-harness'

describe('tool harness', () => {
  it('opens north-up by default and turned with a camera', () => {
    const level = createToolHarness()
    const turned = createToolHarness({ camera: { bearingDeg: 30 } })
    try {
      expect(level.view.view().northUp).toBe(true)
      expect(turned.view.view().camera.bearingDeg).toBe(30)
      // The hover publishes the plane point under the screen centre: the camera's centre, the plane's origin by default.
      turned.hover({ x: 200, y: 150 })
      const world = turned.record.pointerWorld.at(-1)!
      expect(world.x).toBeCloseTo(0, 6)
      expect(world.y).toBeCloseTo(0, 6)
    } finally {
      level.dispose()
      turned.dispose()
    }
  })
})
