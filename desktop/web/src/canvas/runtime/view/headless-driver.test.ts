import { effect } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { createTestView, type TestView } from '../../../__tests__/support/test-view'
import { mapZoomToStageScale } from '../../projection'
import { createSessionPlane } from '../../session-plane'
import type { CameraDriver, CameraMove } from './camera-driver'
import type { ViewCamera, ViewFrame } from './types'
import { planarCameraOf } from './view-transform'

const EQUATOR_MIN_SCALE = mapZoomToStageScale(0, 0)
const EQUATOR_MAX_SCALE = mapZoomToStageScale(27, 0)
const WORLD_POINTS = [{ x: 0, y: 0 }, { x: 13.25, y: -7.5 }, { x: -350, y: 1200 }, { x: 1e4, y: -3e3 }]
const SCREEN_POINTS = [{ x: 0, y: 0 }, { x: 140, y: 110 }, { x: 399.5, y: 3 }, { x: 1000, y: 800 }]

/** The test view's driver, and every frame it publishes from now on. */
function driverOf(view: TestView): { driver: CameraDriver; published: ViewFrame[] } {
  const driver = view.host.current()
  const published: ViewFrame[] = []
  driver.frames.onViewFrame('overlays', (frame) => published.push(frame))
  return { driver, published }
}

/** What today's CameraController read back after a move: its viewport, screen, density and mode, bit for bit. */
interface TodayReadback {
  readonly viewport: { readonly x: number; readonly y: number; readonly scale: number }
  readonly screen: { readonly width: number; readonly height: number; readonly devicePixelRatio: number }
  readonly mode: 'site' | 'overview'
}

/** Readbacks bit for bit: the placement, both projections (today's p × scale + { x, y } and its inverse), the scale and the mode. */
function expectReadsAsToday(frame: ViewFrame, today: TodayReadback, compareMinimum = true): void {
  const { viewport } = today
  expect(planarCameraOf(frame.view)).toEqual({ ...viewport, bearingDeg: 0 })
  expect(frame.view.pixelsPerMetre).toBe(viewport.scale)
  for (const point of WORLD_POINTS) {
    expect(frame.view.worldToScreen(point)).toEqual({ x: point.x * viewport.scale + viewport.x, y: point.y * viewport.scale + viewport.y })
  }
  for (const point of SCREEN_POINTS) {
    expect(frame.view.screenToWorld(point)).toEqual({ x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale })
  }
  expect(frame.view.screen).toEqual(today.screen)
  expect(frame.mode).toBe(today.mode)
  expect(frame.scaleBounds.max).toBe(EQUATOR_MAX_SCALE)
  if (compareMinimum) expect(frame.scaleBounds.min).toBe(EQUATOR_MIN_SCALE)
}

describe('headless camera driver', () => {
  it('jumpTo publishes one frame with the requested camera', () => {
    const view = createTestView({ plane: createSessionPlane({ lon: 2.35, lat: 48.85 }) })
    const { driver, published } = driverOf(view)
    const targets: ViewCamera[] = [
      { center: { lon: 2.3512, lat: 48.8541 }, zoom: 18.25, bearingDeg: 0, pitchDeg: 0 },
      { center: { lon: 2.3499, lat: 48.8502 }, zoom: 16.5, bearingDeg: 30, pitchDeg: 0 },
    ]

    for (const [index, target] of targets.entries()) {
      driver.apply({ kind: 'set', target, animation: 'none' })

      expect(published).toHaveLength(index + 1)
      const { camera } = published[index]!.view
      expect(camera.center.lon).toBeCloseTo(target.center.lon, 9)
      expect(camera.center.lat).toBeCloseTo(target.center.lat, 9)
      expect(camera.zoom).toBeCloseTo(target.zoom, 9)
      expect(camera.bearingDeg).toBe(target.bearingDeg)
      expect(driver.frames.viewFrame.peek()).toBe(published[index])
    }

    // No map, no flight: a 'fly' jumps in one frame, as today's detached camera did.
    driver.apply({ kind: 'set', target: targets[0]!, animation: 'fly' })
    expect(published).toHaveLength(3)
    expect(published[2]!.moving).toBe(false)
    expect(published[2]!.view.camera.zoom).toBeCloseTo(18.25, 9)
    view.dispose()
  })

  it('a tween advances only on the injected clock', () => {
    const view = createTestView()
    const { driver, published } = driverOf(view)

    driver.apply({ kind: 'rotate-around', anchorPx: 'centre', bearingDeg: 90, animation: 'ease' })
    expect(driver.bearingTarget()).toBe(90)
    // The tween starts moving and waits for the first animation frame.
    expect(published).toHaveLength(1)
    expect(published[0]!.moving).toBe(true)
    expect(published[0]!.view.camera.bearingDeg).toBe(0)

    view.clock.advance(100)
    expect(published).toHaveLength(2)
    expect(published[1]!.view.camera.bearingDeg).toBeCloseTo(90 * (1 - (2 / 3) ** 3), 9)
    expect(published[1]!.moving).toBe(true)

    view.clock.advance(200)
    expect(published).toHaveLength(3)
    expect(published[2]!.view.camera.bearingDeg).toBe(90)
    expect(published[2]!.moving).toBe(false)
    expect(driver.bearingTarget()).toBe(90)
    // The ground under the screen centre stayed put.
    const centre = { x: 200, y: 150 }
    const startCentre = published[0]!.view.screenToWorld(centre)!
    const endCentre = published[2]!.view.screenToWorld(centre)!
    expect(endCentre.x).toBeCloseTo(startCentre.x, 6)
    expect(endCentre.y).toBeCloseTo(startCentre.y, 6)

    view.clock.advance(1000)
    expect(published).toHaveLength(3)
    view.dispose()
  })

  it('a still headless camera reproduces today\'s CameraController exactly', () => {
    const plane = createSessionPlane({ lon: 0, lat: 0 })
    const next = createSessionPlane(plane.toGeo({ x: 12_500, y: -4_000 }))
    const steps: ReadonlyArray<CameraMove | ((driver: CameraDriver) => void)> = [
      { kind: 'pan-by', deltaPx: { x: 17.25, y: -3.5 } },
      { kind: 'zoom-around', anchorPx: { x: 140, y: 110 }, factor: 2.5 },
      { kind: 'zoom-around', anchorPx: { x: 200, y: 150 }, factor: 1.1 },
      { kind: 'zoom-around', anchorPx: { x: 200, y: 150 }, factor: 1 / 1.1 },
      { kind: 'place', planar: { x: -200.125, y: 91.75, scale: 3.3, bearingDeg: 0 } },
      { kind: 'zoom-around', anchorPx: { x: 10, y: 290 }, factor: 0.37 },
      { kind: 'pan-by', deltaPx: { x: 0, y: 0 } },
      { kind: 'place', planar: { x: -200.125 * 0.37, y: 91.75, scale: 3.3, bearingDeg: 0 } },
      { kind: 'place', planar: { x: 5, y: 5, scale: 1e9, bearingDeg: 0 } },
      { kind: 'zoom-around', anchorPx: { x: 200, y: 150 }, factor: 1e-12 },
      { kind: 'place', planar: { x: 31, y: -7, scale: 0.05, bearingDeg: 0 } },
      { kind: 'zoom-around', anchorPx: { x: 0.5, y: 299 }, factor: Number.NaN },
      (driver) => driver.setScreen({ width: 300, height: 200, devicePixelRatio: 1 }),
      (driver) => driver.setScreen({ width: 300, height: 200, devicePixelRatio: 2 }),
      (driver) => driver.planeChanged(next),
      { kind: 'zoom-around', anchorPx: { x: 77, y: 12 }, factor: 3 },
    ]
    const SCREEN_400 = { width: 400, height: 300, devicePixelRatio: 1 }
    const SCREEN_300 = { width: 300, height: 200, devicePixelRatio: 1 }
    const SCREEN_300_DENSE = { width: 300, height: 200, devicePixelRatio: 2 }
    // Today's CameraController after the same calls (panBy, zoomAroundScreenPoint, zoomIn, zoomOut, setViewport, resize and
    // reprojectViewport with plane.transformTo(next)), from { x: 0, y: 0, scale: 1 } on 400 × 300: its viewport, the frames it
    // published, its mode and its screen, recorded at 52cbff10 before the class became the legacy shim.
    const today: ReadonlyArray<readonly [number, number, number, number, 'site' | 'overview', TodayReadback['screen']]> = [
      [17.25, -3.5, 1, 1, 'site', SCREEN_400],
      [-166.875, -173.75, 2.5, 1, 'site', SCREEN_400],
      [-203.5625, -206.125, 2.75, 1, 'site', SCREEN_400],
      [-166.875, -173.75, 2.5, 1, 'site', SCREEN_400],
      [-200.125, 91.75, 3.3, 1, 'site', SCREEN_400],
      [-67.74625, 216.6475, 1.2209999999999999, 1, 'site', SCREEN_400],
      [-67.74625, 216.6475, 1.2209999999999999, 0, 'site', SCREEN_400],
      [-74.04625, 91.75, 3.3, 1, 'site', SCREEN_400],
      [5, 5, 1716.6895781438734, 1, 'site', SCREEN_400],
      [199.99999854713678, 149.9999989196658, 1.2790334061860095e-05, 1, 'overview', SCREEN_400],
      [31, -7, 0.05, 1, 'overview', SCREEN_400],
      [31, -7, 0.05, 0, 'overview', SCREEN_400],
      [31, -7, 0.05, 1, 'overview', SCREEN_300],
      [31, -7, 0.05, 1, 'overview', SCREEN_300_DENSE],
      [656.0000000000174, -207.0000000000233, 0.050000009854704264, 1, 'overview', SCREEN_300_DENSE],
      [1814.000000000052, -645.0000000000699, 0.1500000295641128, 1, 'site', SCREEN_300_DENSE],
    ]

    const view = createTestView({ plane })
    const { driver, published } = driverOf(view)
    expectReadsAsToday(driver.frames.viewFrame.peek(), { viewport: { x: 0, y: 0, scale: 1 }, screen: SCREEN_400, mode: 'site' })
    for (const [index, move] of steps.entries()) {
      const before = published.length
      if (typeof move === 'function') move(driver)
      else driver.apply(move)

      const [x, y, scale, frames, mode, screen] = today[index]!
      expect(published.length - before).toBe(frames)
      expectReadsAsToday(driver.frames.viewFrame.peek(), { viewport: { x, y, scale }, screen, mode })
    }
    view.dispose()

    // A larger screen: every scale above its single-world floor reads back as today's (from today's 1000 × 800 initial frame).
    const wide = createTestView({ screen: { width: 1000, height: 800 }, viewport: { x: 100, y: 0, scale: 8 } })
    const wideDriver = wide.host.current()
    const wideToday: ReadonlyArray<readonly [number, number, number]> = [
      [117.25, -3.5, 8],
      [83.125, -173.75, 20],
      [-200.125, 91.75, 3.3],
      [-67.74625, 216.6475, 1.2209999999999999],
      [-67.74625, 216.6475, 1.2209999999999999],
      [-74.04625, 91.75, 3.3],
    ]
    for (const [index, stepIndex] of [0, 1, 4, 5, 6, 7].entries()) {
      wideDriver.apply(steps[stepIndex] as CameraMove)
      const [x, y, scale] = wideToday[index]!
      expectReadsAsToday(wideDriver.frames.viewFrame.peek(), {
        viewport: { x, y, scale },
        screen: { width: 1000, height: 800, devicePixelRatio: 1 },
        mode: 'site',
      }, false)
    }
    wide.dispose()
  })

  it('setScreen with an unchanged size publishes nothing', () => {
    const view = createTestView({ viewport: { x: 12, y: -3, scale: 2 } })
    const { driver, published } = driverOf(view)

    driver.setScreen({ width: 400, height: 300, devicePixelRatio: 1 })
    expect(published).toHaveLength(0)

    driver.setScreen({ width: 500, height: 320, devicePixelRatio: 1 })
    expect(published).toHaveLength(1)
    expect(published[0]!.view.screen).toEqual({ width: 500, height: 320, devicePixelRatio: 1 })
    // Today's resize keeps the placement.
    expect(planarCameraOf(published[0]!.view)).toEqual({ x: 12, y: -3, scale: 2, bearingDeg: 0 })

    driver.setScreen({ width: 500, height: 320, devicePixelRatio: 1 })
    expect(published).toHaveLength(1)
    view.dispose()
  })

  // Moved from __tests__/camera-controller.test.ts (CameraController > …): the driver's frames carry what the snapshot did.

  it('starts with one coherent unpublished viewport snapshot', () => {
    const view = createTestView({ screen: { width: 0, height: 0 } })
    const frame = view.host.current().frames.viewFrame.value

    expect(planarCameraOf(frame.view)).toEqual({ x: 0, y: 0, scale: 1, bearingDeg: 0 })
    expect(frame.view.screen).toEqual({ width: 0, height: 0, devicePixelRatio: 1 })
    expect(frame.scaleBounds).toEqual({ min: EQUATOR_MIN_SCALE, max: EQUATOR_MAX_SCALE })
    expect(frame.mode).toBe('site')
    expect(frame.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(frame.attached).toBe(false)
    expect(frame.moving).toBe(false)
    expect(frame.revision).toBe(0)
    expect(frame.view.revision).toBe(0)
    view.dispose()
  })

  it('publishes device-pixel ratio changes as part of the immutable frame', () => {
    const view = createTestView({ screen: { width: 1000, height: 800, devicePixelRatio: 2 } })
    const driver = view.host.current()
    const initial = driver.frames.viewFrame.value
    expect(initial.view.screen).toEqual({ width: 1000, height: 800, devicePixelRatio: 2 })

    driver.setScreen({ width: 1000, height: 800, devicePixelRatio: 3 })
    expect(driver.frames.viewFrame.value.revision).toBe(initial.revision + 1)
    expect(driver.frames.viewFrame.value.view.screen.devicePixelRatio).toBe(3)
    view.dispose()
  })

  it('normalizes invalid screen metrics before publishing a frame', () => {
    const view = createTestView()
    const driver = view.host.current()

    driver.setScreen({ width: Number.NaN, height: Number.POSITIVE_INFINITY, devicePixelRatio: 0 })

    const frame = driver.frames.viewFrame.value
    expect(frame.view.screen).toEqual({ width: 0, height: 0, devicePixelRatio: 1 })
    expect(Object.values(planarCameraOf(frame.view)).every(Number.isFinite)).toBe(true)
    view.dispose()
  })

  it('increments once for each effective pan, zoom, resize, and reinitialization', () => {
    const view = createTestView({ screen: { width: 1000, height: 800 }, viewport: { x: 100, y: 0, scale: 8 } })
    const driver = view.host.current()
    const revision = () => driver.frames.viewFrame.value.revision

    driver.apply({ kind: 'pan-by', deltaPx: { x: 10, y: -5 } })
    expect(revision()).toBe(1)
    expect(planarCameraOf(driver.frames.viewFrame.value.view)).toEqual({ x: 110, y: -5, scale: 8, bearingDeg: 0 })

    driver.apply({ kind: 'zoom-around', anchorPx: { x: 500, y: 400 }, factor: 1.1 })
    expect(revision()).toBe(2)

    driver.setScreen({ width: 1200, height: 900, devicePixelRatio: 1 })
    expect(revision()).toBe(3)
    expect(driver.frames.viewFrame.value.view.screen).toEqual({ width: 1200, height: 900, devicePixelRatio: 1 })

    // Today's initial frame for 1200 × 900: a 100 m square centred.
    driver.apply({ kind: 'place', planar: { x: 150, y: 0, scale: 9, bearingDeg: 0 } })
    expect(revision()).toBe(4)
    view.dispose()
  })

  it('does not publish no-op viewport mutations', () => {
    const view = createTestView({ screen: { width: 1000, height: 800 }, viewport: { x: 100, y: 0, scale: 8 } })
    const driver = view.host.current()
    const initialRevision = driver.frames.viewFrame.value.revision

    driver.apply({ kind: 'place', planar: planarCameraOf(driver.frames.viewFrame.value.view) })
    driver.apply({ kind: 'pan-by', deltaPx: { x: 0, y: 0 } })
    driver.setScreen({ width: 1000, height: 800, devicePixelRatio: 1 })
    expect(driver.frames.viewFrame.value.revision).toBe(initialRevision)

    driver.apply({ kind: 'place', planar: { x: 100, y: 0, scale: EQUATOR_MAX_SCALE, bearingDeg: 0 } })
    const maximumRevision = driver.frames.viewFrame.value.revision
    driver.apply({ kind: 'zoom-around', anchorPx: { x: 500, y: 400 }, factor: 1.1 })
    expect(driver.frames.viewFrame.value.revision).toBe(maximumRevision)
    view.dispose()
  })

  it('owns immutable nested snapshot values', () => {
    const view = createTestView({ screen: { width: 1000, height: 800 }, viewport: { x: 100, y: 0, scale: 8 } })
    const driver = view.host.current()
    driver.apply({ kind: 'pan-by', deltaPx: { x: 1, y: 1 } })
    const frame = driver.frames.viewFrame.value

    for (const value of [frame, frame.view, frame.view.screen, frame.view.camera, frame.scaleBounds, frame.insets, frame.view.planar]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
    expect(() => {
      ;(frame.view.screen as { width: number }).width = 999
    }).toThrow()
    expect(() => {
      ;(frame as { revision: number }).revision = 999
    }).toThrow()
    expect(planarCameraOf(driver.frames.viewFrame.value.view).x).toBe(101)
    view.dispose()
  })

  it('keeps imperative camera reads out of the caller reactive graph', () => {
    const view = createTestView()
    const driver = view.host.current()
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns += 1
      void driver.frames.viewFrame.peek()
      void driver.bearingTarget()
      void view.view()
    })

    driver.apply({ kind: 'pan-by', deltaPx: { x: 4, y: 2 } })
    driver.setScreen({ width: 640, height: 480, devicePixelRatio: 1 })
    dispose()

    expect(effectRuns).toBe(1)
    view.dispose()
  })
})
