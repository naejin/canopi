// canvas/runtime/view/headless-driver.ts  (tweens run on the window's animation frames)
//
// Owns the camera while no map is attached (tests, before attach, after a failure): a geographic ViewCamera, moved with the same
// camera-math and constrainCamera as the MapLibre driver and built with the one buildViewTransform (ADR 0016). Every move publishes
// one ViewFrame when anything in it changed. A resize keeps the view centre, as MapLibre does; a re-origin keeps the camera's
// ground and rebuilds the frame in the new plane.

import { signal } from '@preact/signals'
import { stageScaleToMapZoom } from '../../projection'
import type { SessionPlane } from '../../session-plane'
import { isWorkspaceOverviewScale } from '../../workspace-camera-policy'
import { startBearingTween, type BearingTween } from './bearing-tween'
import type { CameraDriver, CameraDriverDeps, CameraDriverFailure, CameraMove } from './camera-driver'
import { panCamera, rotateCameraAround, zoomCameraAround } from './camera-math'
import { createDriverFrameSource } from './frame-source'
import { constrainCamera, normaliseBearing, scaleBoundsAt, VIEW_EASE_MS, zoomFloorForArc } from './navigation-policy'
import type { ScreenInsets, ScreenPoint, ViewCamera, ViewFrame, ViewScreen } from './types'
import { buildViewTransform } from './view-transform'

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

/** Everything a frame is built from; a move publishes only when one of these changed. */
interface FrameState {
  readonly camera: ViewCamera
  readonly screen: ViewScreen
  readonly insets: ScreenInsets
  readonly scaleBounds: { readonly min: number; readonly max: number }
  readonly overviewPixelsPerMetre: number
  readonly moving: boolean
  readonly plane: SessionPlane
  readonly planeRevision: number
}

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
  const frames = createDriverFrameSource(buildFrame(published))

  /** The zoom range and the one-world hold at the camera's bearing. */
  function constrained(candidate: ViewCamera): ViewCamera {
    const held = constrainCamera(candidate, screen, deps.policy())
    return Object.isFrozen(held) ? held : Object.freeze({ ...held, center: Object.freeze({ ...held.center }) })
  }

  function frameState(): FrameState {
    const policy = deps.policy()
    return {
      camera,
      screen,
      insets,
      scaleBounds: scaleBoundsAt(screen, policy, camera.bearingDeg),
      overviewPixelsPerMetre: policy.overviewPixelsPerMetre,
      moving: tween !== null,
      plane,
      planeRevision,
    }
  }

  function buildFrame(state: FrameState): ViewFrame {
    // The host stamps the revisions readers see.
    const view = buildViewTransform({
      camera: state.camera,
      screen: state.screen,
      plane: state.plane,
      planeRevision: state.planeRevision,
      revision: 0,
    })
    return Object.freeze<ViewFrame>({
      view,
      mode: isWorkspaceOverviewScale(view.pixelsPerMetre, { overviewScaleThreshold: state.overviewPixelsPerMetre }) ? 'overview' : 'site',
      scaleBounds: state.scaleBounds,
      insets: state.insets,
      attached: false,
      moving: state.moving,
      revision: 0,
    })
  }

  function commit(candidate: ViewCamera | null): void {
    if (!candidate) return
    camera = constrained(candidate)
    const state = frameState()
    if (sameFrameState(published, state)) return
    published = state
    frames.publish(buildFrame(state))
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
    const policy = deps.policy()
    const floor = Math.max(policy.minZoom, zoomFloorForArc(screen, policy, camera.bearingDeg, camera.bearingDeg))
    const wanted = camera.zoom + Math.log2(factor)
    const zoom = Math.min(policy.maxZoom, Math.max(Math.min(policy.maxZoom, floor), wanted))
    return zoomCameraAround(camera, screen, anchor, zoom === wanted ? factor : 2 ** (zoom - camera.zoom))
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
            durationMs: move.durationMs ?? VIEW_EASE_MS,
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

function sameFrameState(previous: FrameState, next: FrameState): boolean {
  return previous.camera.center.lon === next.camera.center.lon
    && previous.camera.center.lat === next.camera.center.lat
    && previous.camera.zoom === next.camera.zoom
    && previous.camera.bearingDeg === next.camera.bearingDeg
    && previous.screen.width === next.screen.width
    && previous.screen.height === next.screen.height
    && previous.screen.devicePixelRatio === next.screen.devicePixelRatio
    && previous.insets.top === next.insets.top
    && previous.insets.right === next.insets.right
    && previous.insets.bottom === next.insets.bottom
    && previous.insets.left === next.insets.left
    && previous.scaleBounds.min === next.scaleBounds.min
    && previous.scaleBounds.max === next.scaleBounds.max
    && previous.overviewPixelsPerMetre === next.overviewPixelsPerMetre
    && previous.moving === next.moving
    && previous.plane === next.plane
    && previous.planeRevision === next.planeRevision
}

/** A camera with any non-finite value is refused; the bearing is normalised. */
function validCamera(camera: ViewCamera): ViewCamera | null {
  if (![camera.center.lon, camera.center.lat, camera.zoom, camera.bearingDeg].every(Number.isFinite)) return null
  const bearingDeg = normaliseBearing(camera.bearingDeg)
  return bearingDeg === camera.bearingDeg ? camera : { ...camera, bearingDeg }
}

/** Invalid sizes read as 0, an invalid density as 1. */
function normaliseScreen(screen: ViewScreen): ViewScreen {
  const size = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0)
  const density = screen.devicePixelRatio
  return Object.freeze({
    width: size(screen.width),
    height: size(screen.height),
    devicePixelRatio: Number.isFinite(density) && density > 0 ? density : 1,
  })
}

function frozenInsets(insets: ScreenInsets): ScreenInsets {
  return Object.freeze({ top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left })
}

function finitePoint(point: ScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}
