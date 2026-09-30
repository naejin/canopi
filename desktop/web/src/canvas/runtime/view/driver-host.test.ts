import { signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { createTestView } from '../../../__tests__/support/test-view'
import { createSessionPlane, type SessionPlane } from '../../session-plane'
import { createWorkspaceCameraPolicy } from '../../workspace-camera-policy'
import { CameraController } from '../camera'
import type { CameraDriver, CameraDriverFailure } from './camera-driver'
import { createHeadlessCameraDriver } from './headless-driver'
import { createNavigationPolicy } from './navigation-policy'
import type { ViewFrame } from './types'
import { planarCameraOf } from './view-transform'

/** A driver standing in for an attached one: its own camera, far from the host's until the host hands it over. */
function standInDriver(plane: SessionPlane): CameraDriver {
  return createHeadlessCameraDriver({
    deps: {
      clock: () => 0,
      scheduleFrame: () => () => {},
      policy: () => createNavigationPolicy(createWorkspaceCameraPolicy(), signal(false)),
    },
    timers: { set: () => 0, clear: () => {} },
    plane,
    screen: { width: 400, height: 300, devicePixelRatio: 1 },
    camera: { x: -5_000, y: 9_000, scale: 0.5, bearingDeg: 0 },
  })
}

function recordFrames(view: ReturnType<typeof createTestView>): ViewFrame[] {
  const published: ViewFrame[] = []
  view.frames.onViewFrame('overlays', (frame) => published.push(frame))
  return published
}

describe('camera driver host', () => {
  it('attach hands the camera to the attached driver, and detach takes it back', () => {
    const plane = createSessionPlane({ lon: 2.35, lat: 48.85 })
    const view = createTestView({ plane, viewport: { x: 40, y: -25, scale: 3 } })
    const published = recordFrames(view)
    const before = view.frames.viewFrame.peek()
    const attached = standInDriver(plane)

    view.host.attach(attached)

    expect(view.host.current()).toBe(attached)
    expect(published).toHaveLength(1)
    const handed = published[0]!
    expect(handed.attached).toBe(true)
    expect(handed.revision).toBe(before.revision + 1)
    expect(handed.view.camera.center.lon).toBeCloseTo(before.view.camera.center.lon, 9)
    expect(handed.view.camera.center.lat).toBeCloseTo(before.view.camera.center.lat, 9)
    expect(handed.view.camera.zoom).toBeCloseTo(before.view.camera.zoom, 9)

    view.navigation.panByPx({ x: 30, y: 0 })
    expect(published).toHaveLength(2)
    expect(published[1]!.attached).toBe(true)
    const lastAttached = published[1]!.view.camera

    view.host.detach()

    expect(view.host.current()).not.toBe(attached)
    expect(published).toHaveLength(3)
    expect(published[2]!.attached).toBe(false)
    expect(published[2]!.view.camera.center.lon).toBeCloseTo(lastAttached.center.lon, 9)
    expect(published[2]!.view.camera.center.lat).toBeCloseTo(lastAttached.center.lat, 9)
    expect(published[2]!.view.camera.zoom).toBeCloseTo(lastAttached.zoom, 9)
    // The detached driver is disposed: it no longer moves anything.
    attached.apply({ kind: 'pan-by', deltaPx: { x: 5, y: 5 } })
    expect(published).toHaveLength(3)
    view.dispose()
  })

  it('a driver failure detaches the host and reports it', () => {
    const plane = createSessionPlane({ lon: 2.35, lat: 48.85 })
    const view = createTestView({ plane })
    const published = recordFrames(view)
    const failure = signal<CameraDriverFailure | null>(null)
    const attached: CameraDriver = { ...standInDriver(plane), failure }
    view.host.attach(attached)
    view.navigation.panByPx({ x: -12, y: 7 })
    const lastAttached = view.frames.viewFrame.peek().view.camera

    failure.value = { reason: 'map-error', message: 'The map reported a pitched camera.' }

    expect(view.host.failure.value).toEqual({ reason: 'map-error', message: 'The map reported a pitched camera.' })
    expect(view.host.current()).not.toBe(attached)
    const detached = published.at(-1)!
    expect(detached.attached).toBe(false)
    expect(detached.view.camera.center.lon).toBeCloseTo(lastAttached.center.lon, 9)
    expect(detached.view.camera.center.lat).toBeCloseTo(lastAttached.center.lat, 9)

    // The next attachment starts without a failure.
    view.host.attach(standInDriver(plane))
    expect(view.host.failure.value).toBeNull()
    expect(view.frames.viewFrame.peek().attached).toBe(true)
    view.dispose()
  })

  it('a driver that fails when it is built or while taking the camera is never relayed', () => {
    const plane = createSessionPlane({ lon: 2.35, lat: 48.85 })
    const view = createTestView({ plane, viewport: { x: 40, y: -25, scale: 3 } })
    const published = recordFrames(view)
    const headless = view.host.current()
    const before = view.frames.viewFrame.peek()
    const refusal: CameraDriverFailure = { reason: 'map-error', message: 'The map cannot be driven without getBearing.' }

    // Built failed (a map it cannot drive): it never takes the camera, and the frame does not move.
    const refused = standInDriver(plane)
    view.host.attach({ ...refused, failure: signal<CameraDriverFailure | null>(refusal) })
    expect(view.host.failure.value).toEqual(refusal)
    expect(view.host.current()).toBe(headless)
    expect(view.frames.viewFrame.peek()).toBe(before)
    expect(published).toHaveLength(0)

    // Failing while it is handed the camera: its frame is never published; the host detaches at the camera it had.
    const failing = standInDriver(plane)
    const failure = signal<CameraDriverFailure | null>(null)
    view.host.attach({
      ...failing,
      failure,
      apply(move) {
        failing.apply(move)
        failure.value = { reason: 'map-error', message: 'The map reported a pitched camera.' }
      },
    })
    expect(view.host.failure.value).toEqual({ reason: 'map-error', message: 'The map reported a pitched camera.' })
    expect(published).toHaveLength(1)
    expect(published[0]!.attached).toBe(false)
    expect(published[0]!.view.camera.center.lon).toBeCloseTo(before.view.camera.center.lon, 9)
    expect(published[0]!.view.camera.zoom).toBeCloseTo(before.view.camera.zoom, 9)
    view.dispose()
  })

  it('revisions and plane revisions stay monotonic across swaps', () => {
    const plane = createSessionPlane({ lon: 2.35, lat: 48.85 })
    const view = createTestView({ plane })
    const published = recordFrames(view)

    view.navigation.panByPx({ x: 3, y: 4 })
    view.host.attach(standInDriver(plane))
    view.navigation.zoomIn()
    view.host.current().planeChanged(createSessionPlane({ lon: 2.5, lat: 48.9 }))
    view.host.detach()
    view.navigation.zoomOut()

    const revisions = published.map((frame) => frame.revision)
    expect(revisions).toEqual(revisions.map((_, index) => index + 1))
    expect(published.map((frame) => frame.view.revision)).toEqual(revisions)
    // The same plane across the swaps; one re-origin.
    expect(published.map((frame) => frame.view.planeRevision)).toEqual([0, 0, 0, 1, 1, 1])
    view.dispose()
  })

  it('replacePolicy re-constrains the camera to the new bounds about the screen centre', () => {
    const northern = createWorkspaceCameraPolicy(45)
    const equatorial = createWorkspaceCameraPolicy(0)
    const camera = new CameraController(northern)
    camera.initialize({ width: 400, height: 300 })
    camera.setViewport({ x: 10, y: -20, scale: camera.snapshot.value.scaleBounds.maximum })
    const view = createTestView({ policy: northern, viewport: camera.viewport })

    view.host.replacePolicy(equatorial)
    camera.replacePolicy(equatorial)

    expect(planarCameraOf(view.view())).toEqual({ ...camera.viewport, bearingDeg: 0 })
    expect(view.frames.viewFrame.peek().scaleBounds).toEqual({
      min: camera.snapshot.value.scaleBounds.minimum,
      max: camera.snapshot.value.scaleBounds.maximum,
    })
    view.dispose()
  })

  it('moves during frame dispatch are queued until every listener ran', () => {
    const view = createTestView()
    const seen: Array<readonly [string, number]> = []
    let panned = false
    view.frames.onViewFrame('tools', (frame) => {
      seen.push(['tools', frame.revision])
      if (panned) return
      panned = true
      view.navigation.panByPx({ x: 10, y: 0 })
      // Still the frame being dispatched.
      seen.push(['after the move', view.frames.viewFrame.peek().revision])
    })
    view.frames.onViewFrame('overlays', (frame) => seen.push(['overlays', frame.revision]))

    view.navigation.panByPx({ x: 1, y: 0 })

    expect(seen).toEqual([
      ['tools', 1],
      ['after the move', 1],
      ['overlays', 1],
      ['tools', 2],
      ['overlays', 2],
    ])
    expect(planarCameraOf(view.view()).x).toBe(11)
    view.dispose()
  })

  it('moves made on the attach and detach frames are queued until every listener ran', () => {
    const plane = createSessionPlane({ lon: 2.35, lat: 48.85 })
    const view = createTestView({ plane, viewport: { x: 40, y: -25, scale: 3 } })
    const seen: Array<readonly [string, number]> = []
    const published: ViewFrame[] = []
    let moveOnAttached: boolean | null = null
    view.frames.onViewFrame('tools', (frame) => {
      seen.push(['tools', frame.revision])
      if (frame.attached !== moveOnAttached) return
      moveOnAttached = null
      view.navigation.panByPx({ x: 10, y: 0 })
      // Still the frame being dispatched.
      seen.push(['after the move', view.frames.viewFrame.peek().revision])
    })
    view.frames.onViewFrame('overlays', (frame) => {
      seen.push(['overlays', frame.revision])
      published.push(frame)
    })

    moveOnAttached = true
    view.host.attach(standInDriver(plane))
    moveOnAttached = false
    view.host.detach()

    expect(seen).toEqual([
      ['tools', 1],
      ['after the move', 1],
      ['overlays', 1],
      ['tools', 2],
      ['overlays', 2],
      ['tools', 3],
      ['after the move', 3],
      ['overlays', 3],
      ['tools', 4],
      ['overlays', 4],
    ])
    expect(published.map((frame) => frame.attached)).toEqual([true, true, false, false])
    const x = published.map((frame) => planarCameraOf(frame.view).x)
    expect(x[1]! - x[0]!).toBeCloseTo(10, 9)
    // The detached driver starts from the attached camera through lon/lat.
    expect(x[2]!).toBeCloseTo(x[1]!, 6)
    expect(x[3]! - x[2]!).toBeCloseTo(10, 9)
    expect(view.frames.viewFrame.peek()).toBe(published[3])
    view.dispose()
  })
})
