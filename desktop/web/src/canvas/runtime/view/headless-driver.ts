// canvas/runtime/view/headless-driver.ts  (tweens run on the window's animation frames)
//
// Owns the camera while no map is attached (tests, before attach, after a failure): a geographic ViewCamera, moved with the same
// camera-math and constrainCamera as the MapLibre driver and built with the one buildViewTransform (ADR 0016). Every move publishes
// one ViewFrame when anything in it changed. A resize keeps the view centre, as MapLibre does; a re-origin keeps the camera's
// ground and rebuilds the frame in the new plane.

import { signal } from '@preact/signals'
import { stageScaleToMapZoom } from '../../projection'
import type { SessionPlane } from '../../session-plane'
import { startBearingTween, type BearingTween } from './bearing-tween'
import type { CameraDriver, CameraDriverDeps, CameraDriverFailure, CameraMove } from './camera-driver'
import { panCamera, rotateCameraAround, zoomCameraAround } from './camera-math'
import {
  driverFrame,
  driverFrameState,
  finitePoint,
  normaliseScreen,
  sameDriverFrameState,
  zoomFactorWithinRange,
  type DriverFrameState,
} from './driver-frame'
import { createDriverFrameSource } from './frame-source'
import { constrainCamera, normaliseBearing, VIEW_EASE_MS } from './navigation-policy'
import type { ScreenInsets, ScreenPoint, ViewCamera, ViewScreen } from './types'

export interface HeadlessCameraDriverOptions {
  readonly deps: CameraDriverDeps
  readonly plane: SessionPlane
  /** Invalid sizes read as 0 and an invalid density as 1. */
  readonly screen: ViewScreen
  /** The starting camera, constrained like a move; it is the first frame, which is not published. */
  readonly camera: ViewCamera
  readonly insets?: ScreenInsets
}

const NO_INSETS: ScreenInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

export function createHeadlessCameraDriver(options: HeadlessCameraDriverOptions): CameraDriver {
  const { deps } = options
  let plane = options.plane
  let planeRevision = 0
  let screen = normaliseScreen(options.screen)
  let insets = frozenInsets(options.insets ?? NO_INSETS)
  let tween: BearingTween | null = null
  let frameRequest: number | null = null
  let disposed = false
  const queued: Array<() => void> = []
  const failure = signal<CameraDriverFailure | null>(null)

  let camera = constrained(validCamera(options.camera)
    ?? { center: plane.origin, zoom: stageScaleToMapZoom(1, plane.origin.lat), bearingDeg: 0, pitchDeg: 0 })
  let published = frameState()
  const frames = createDriverFrameSource(driverFrame(published, false))

  /** The zoom range and the one-world hold at the camera's bearing. */
  function constrained(candidate: ViewCamera): ViewCamera {
    const held = constrainCamera(candidate, screen, deps.policy())
    return Object.isFrozen(held) ? held : Object.freeze({ ...held, center: Object.freeze({ ...held.center }) })
  }

  function frameState(): DriverFrameState {
    return driverFrameState(camera, { screen, insets, plane, planeRevision }, deps.policy())
  }

  function commit(candidate: ViewCamera | null): void {
    if (!candidate) return
    camera = constrained(candidate)
    const state = frameState()
    if (sameDriverFrameState(published, state)) return
    published = state
    frames.publish(driverFrame(state, false))
    while (!frames.dispatching && queued.length > 0) queued.shift()!()
  }

  /** A call made while a frame is dispatched runs once, after every listener, in the same task. */
  function queuedWhileDispatching(run: () => void): boolean {
    if (!frames.dispatching) return false
    queued.push(run)
    return true
  }

  function reducedMotion(): boolean {
    return deps.policy().reducedMotion.peek()
  }

  function startTween(next: BearingTween): void {
    stopTween()
    tween = next
    frameRequest = requestAnimationFrame(stepTween)
    commit(camera)
  }

  function stopTween(): void {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest)
    frameRequest = null
    tween = null
  }

  function stepTween(nowMs: number): void {
    frameRequest = null
    const running = tween
    if (disposed || !running) return
    const step = running.step(camera, screen, nowMs)
    if (step.done) tween = null
    // Every tween frame goes through constrainCamera at that frame's bearing.
    commit(step.camera)
    if (!step.done && tween === running && !disposed) frameRequest = requestAnimationFrame(stepTween)
  }

  /** The zoom factor clamped to the zoom range at the live bearing first, as the MapLibre driver does, so the anchor holds. */
  function zoomAround(anchor: ScreenPoint, factor: number): ViewCamera | null {
    if (!Number.isFinite(factor) || factor <= 0 || !finitePoint(anchor)) return null
    return zoomCameraAround(camera, screen, anchor, zoomFactorWithinRange(camera, screen, deps.policy(), factor))
  }

  function apply(move: CameraMove): void {
    if (disposed || queuedWhileDispatching(() => apply(move))) return
    switch (move.kind) {
      case 'pan-by':
        // A pan during a tween composes with it: the tween's next step starts from the panned camera.
        if (finitePoint(move.deltaPx)) commit(panCamera(camera, screen, move.deltaPx))
        return
      case 'zoom-around':
        commit(zoomAround(move.anchorPx, move.factor))
        return
      case 'rotate-around':
        if (!Number.isFinite(move.bearingDeg) || (move.anchorPx !== 'centre' && !finitePoint(move.anchorPx))) return
        if (move.animation === 'ease' && !reducedMotion()) {
          startTween(startBearingTween(camera, {
            bearingDeg: move.bearingDeg,
            anchorPx: move.anchorPx,
            durationMs: VIEW_EASE_MS,
          }, performance.now()))
          return
        }
        stopTween()
        commit(rotateCameraAround(camera, screen, move.anchorPx, move.bearingDeg))
        return
      case 'set': {
        const target = validCamera(move.target)
        if (!target) return
        // Without a map there is no flight: 'fly' jumps.
        stopTween()
        commit(target)
        return
      }
    }
  }

  function stopAnimation(): void {
    if (disposed || queuedWhileDispatching(stopAnimation) || !tween) return
    stopTween()
    commit(camera)
  }

  function planeChanged(next: SessionPlane): void {
    if (disposed || queuedWhileDispatching(() => planeChanged(next)) || next === plane) return
    plane = next
    planeRevision += 1
    commit(camera)
  }

  function setScreen(next: ViewScreen): void {
    if (disposed || queuedWhileDispatching(() => setScreen(next))) return
    const normalised = normaliseScreen(next)
    if (
      normalised.width === screen.width
      && normalised.height === screen.height
      && normalised.devicePixelRatio === screen.devicePixelRatio
    ) return
    screen = normalised
    commit(camera)
  }

  function setInsets(next: ScreenInsets): void {
    if (disposed || queuedWhileDispatching(() => setInsets(next))) return
    insets = frozenInsets(next)
    commit(camera)
  }

  return {
    frames,
    failure,
    apply,
    bearingTarget: () => (tween ? tween.targetBearingDeg : camera.bearingDeg),
    stopAnimation,
    planeChanged,
    setScreen,
    setInsets,
    dispose() {
      disposed = true
      stopTween()
      queued.length = 0
      frames.dispose()
    },
  }
}

/** A camera with any non-finite value is refused; the bearing is normalised. */
function validCamera(camera: ViewCamera): ViewCamera | null {
  if (![camera.center.lon, camera.center.lat, camera.zoom, camera.bearingDeg].every(Number.isFinite)) return null
  const bearingDeg = normaliseBearing(camera.bearingDeg)
  return bearingDeg === camera.bearingDeg ? camera : { ...camera, bearingDeg }
}

function frozenInsets(insets: ScreenInsets): ScreenInsets {
  return Object.freeze({ top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left })
}
