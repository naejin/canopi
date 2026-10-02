// Deleted with canvas/runtime/legacy-camera-facade.ts at the end of 0D2.

import { effect } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { CameraController, type CameraViewportSnapshot } from './legacy-camera-facade'

describe('legacy CameraController shim', () => {
  it('initialize publishes one snapshot and returns the viewport it published', () => {
    const camera = new CameraController()
    const observed: CameraViewportSnapshot[] = []
    const dispose = effect(() => {
      observed.push(camera.snapshot.value)
    })
    observed.length = 0

    // Today's CameraController returned the viewport it published (camera.ts:225-228 at 52cbff10).
    const returned = camera.initialize({ width: 1000, height: 800 })
    dispose()

    expect(observed).toHaveLength(1)
    expect(observed[0]!.viewport).toEqual({ x: 100, y: 0, scale: 8 })
    expect(observed[0]!.screenSize).toEqual({ width: 1000, height: 800 })
    expect(observed[0]!.revision).toBe(1)
    expect(returned).toEqual({ x: 100, y: 0, scale: 8 })
    expect(camera.initialize({ width: 400, height: 300 })).toEqual({ x: 50, y: 0, scale: 3 })
    expect(camera.viewport).toEqual({ x: 50, y: 0, scale: 3 })
  })
})
