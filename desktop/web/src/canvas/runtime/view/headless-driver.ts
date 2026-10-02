// canvas/runtime/view/headless-driver.ts  (tweens run on the window's animation frames)
//
// Owns the camera while no map is attached (tests, before attach, after a failure): a PlanarCamera moved with today's
// CameraController arithmetic, bit for bit at bearing 0 (ADR 0016, amended 2026-09-30). Every move clamps the scale to the frame's
// scale bounds, holds the view inside one world and publishes one ViewFrame, built from the plane, when anything in it changed.
// Geographic inputs (a 'set' target, each tween step) convert to a PlanarCamera through the plane once; re-origin stays in plane
// terms (planeChanged).

import { signal } from '@preact/signals'
import type { SessionPlane } from '../../session-plane'
import { startBearingTween, type BearingTween } from './bearing-tween'
import type { CameraDriver, CameraDriverDeps, CameraDriverFailure, CameraMove } from './camera-driver'
import {
  panPlanar,
  planarCentredOn,
  planarToViewCamera,
  reprojectPlanar,
  rotatePlanarAround,
  viewCameraToPlanar,
  zoomPlanarToScale,
} from './camera-math'
import { createDriverFrameSource } from './frame-source'
import { constrainCamera, normaliseBearing, scaleBoundsAt, VIEW_EASE_MS } from './navigation-policy'
import type { PlanarCamera, ScreenInsets, ScreenPoint, ViewCamera, ViewFrame, ViewScreen } from './types'
import { buildViewTransformFromPlane } from './view-transform'

export interface HeadlessCameraDriverOptions {
  readonly deps: CameraDriverDeps
  readonly plane: SessionPlane
  /** Invalid sizes read as 0 and an invalid density as 1, as today's CameraController normalised them. */
  readonly screen: ViewScreen
  /** The starting placement, clamped and held like a move; it is the first frame, which is not published. */
  readonly camera: PlanarCamera
  readonly insets?: ScreenInsets
}

const NO_INSETS: ScreenInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })
const TODAY_UNPUBLISHED_CAMERA: PlanarCamera = Object.freeze({ x: 0, y: 0, scale: 1, bearingDeg: 0 })
/** The hold ignores centre moves this small: a plane → lon/lat → plane round trip at the world's edge is never exact. */
const HOLD_NOISE_DEG = 1e-9

/** Everything a frame is built from; a move publishes only when one of these changed. */
interface FrameState {
  readonly planar: PlanarCamera
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
  let revision = 0
  let disposed = false
  const queued: Array<() => void> = []
  const failure = signal<CameraDriverFailure | null>(null)

  let planar = settle(validPlanar(options.camera) ?? TODAY_UNPUBLISHED_CAMERA)
  let published = frameState()
  const frames = createDriverFrameSource(buildFrame(published))

  /** Today's normalizeViewport clamp, in px/m against the frame's scale bounds, then the one-world hold. */
  function settle(candidate: PlanarCamera): PlanarCamera {
    const bounds = scaleBoundsAt(screen, deps.policy(), candidate.bearingDeg)
    const scale = Math.min(bounds.max, Math.max(bounds.min, candidate.scale))
    const clamped = scale === candidate.scale ? candidate : { ...candidate, scale }
    const derived = planarToViewCamera(clamped, screen, plane)
    const held = constrainCamera(derived, screen, deps.policy())
    if (
      Math.abs(held.center.lon - derived.center.lon) <= HOLD_NOISE_DEG
      && Math.abs(held.center.lat - derived.center.lat) <= HOLD_NOISE_DEG
    ) return clamped
    return planarCentredOn(screen, plane.toPlane(held.center), clamped.scale, clamped.bearingDeg)
  }

  function frameState(): FrameState {
    const policy = deps.policy()
    return {
      planar,
      screen,
      insets,
      scaleBounds: scaleBoundsAt(screen, policy, planar.bearingDeg),
      overviewPixelsPerMetre: policy.overviewPixelsPerMetre,
      moving: tween !== null,
      plane,
      planeRevision,
    }
  }

  function buildFrame(state: FrameState): ViewFrame {
    const view = buildViewTransformFromPlane({
      planar: state.planar,
      screen: state.screen,
      plane: state.plane,
      planeRevision: state.planeRevision,
      revision,
    })
    return Object.freeze<ViewFrame>({
      view,
      mode: view.pixelsPerMetre < state.overviewPixelsPerMetre ? 'overview' : 'site',
      scaleBounds: state.scaleBounds,
      insets: state.insets,
      attached: false,
      moving: state.moving,
      revision,
    })
  }

  function commit(candidate: PlanarCamera | null): void {
    if (!candidate) return
    planar = settle(candidate)
    const state = frameState()
    if (sameFrameState(published, state)) return
    published = state
    revision += 1
    frames.publish(buildFrame(state))
    while (!frames.dispatching && queued.length > 0) queued.shift()!()
  }

  /** A call made while a frame is dispatched runs once, after every listener, in the same task. */
  function queuedWhileDispatching(run: () => void): boolean {
    if (!frames.dispatching) return false
    queued.push(run)
    return true
  }

  function liveCamera(): ViewCamera {
    return planarToViewCamera(planar, screen, plane)
  }

  function reducedMotion(): boolean {
    return deps.policy().reducedMotion.peek()
  }

  function startTween(next: BearingTween): void {
    stopTween()
    tween = next
    frameRequest = requestAnimationFrame(stepTween)
    commit(planar)
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
    const live = liveCamera()
    const { camera, done } = running.step(live, screen, nowMs)
    if (done) tween = null
    // Every tween frame goes through constrainCamera at that frame's bearing.
    const constrained = constrainCamera(camera, screen, deps.policy())
    commit(constrained === live ? planar : viewCameraToPlanar(constrained, screen, plane))
    if (!done && tween === running && !disposed) frameRequest = requestAnimationFrame(stepTween)
  }

  function zoomAround(anchor: ScreenPoint, factor: number): PlanarCamera | null {
    if (!Number.isFinite(factor) || factor <= 0 || !finitePoint(anchor)) return null
    const bounds = scaleBoundsAt(screen, deps.policy(), planar.bearingDeg)
    return zoomPlanarToScale(planar, anchor, Math.min(bounds.max, Math.max(bounds.min, planar.scale * factor)))
  }

  function apply(move: CameraMove): void {
    if (disposed || queuedWhileDispatching(() => apply(move))) return
    switch (move.kind) {
      case 'pan-by':
        // A pan during a tween composes with it: the tween's next step starts from the panned camera.
        if (finitePoint(move.deltaPx)) commit(panPlanar(planar, move.deltaPx))
        return
      case 'zoom-around':
        commit(zoomAround(move.anchorPx, move.factor))
        return
      case 'rotate-around':
        if (!Number.isFinite(move.bearingDeg) || (move.anchorPx !== 'centre' && !finitePoint(move.anchorPx))) return
        if (move.animation === 'ease' && !reducedMotion()) {
          startTween(startBearingTween(liveCamera(), {
            bearingDeg: move.bearingDeg,
            anchorPx: move.anchorPx,
            durationMs: move.durationMs ?? VIEW_EASE_MS,
          }, performance.now()))
          return
        }
        stopTween()
        commit(rotatePlanarAround(planar, screen, move.anchorPx, move.bearingDeg))
        return
      case 'set': {
        const { target } = move
        if (![target.center.lon, target.center.lat, target.zoom, target.bearingDeg].every(Number.isFinite)) return
        // Without a map there is no flight: 'fly' jumps, as today's detached camera did.
        stopTween()
        commit(viewCameraToPlanar(target, screen, plane))
        return
      }
      case 'place': {
        const placement = validPlanar(move.planar)
        if (!placement) return
        stopTween()
        commit(placement)
        return
      }
    }
  }

  function stopAnimation(): void {
    if (disposed || queuedWhileDispatching(stopAnimation) || !tween) return
    stopTween()
    commit(planar)
  }

  function planeChanged(next: SessionPlane): void {
    if (disposed || queuedWhileDispatching(() => planeChanged(next)) || next === plane) return
    const transform = plane.transformTo(next)
    plane = next
    planeRevision += 1
    commit(reprojectPlanar(planar, transform))
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
    commit(planar)
  }

  function setInsets(next: ScreenInsets): void {
    if (disposed || queuedWhileDispatching(() => setInsets(next))) return
    insets = frozenInsets(next)
    commit(planar)
  }

  return {
    frames,
    failure,
    apply,
    bearingTarget: () => (tween ? tween.targetBearingDeg : planar.bearingDeg),
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
  return previous.planar.x === next.planar.x
    && previous.planar.y === next.planar.y
    && previous.planar.scale === next.planar.scale
    && previous.planar.bearingDeg === next.planar.bearingDeg
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

/** Today's normalizeViewport: a placement with any non-finite value is refused; the bearing is normalised. */
function validPlanar(camera: PlanarCamera): PlanarCamera | null {
  if (![camera.x, camera.y, camera.scale, camera.bearingDeg].every(Number.isFinite)) return null
  const bearingDeg = normaliseBearing(camera.bearingDeg)
  return bearingDeg === camera.bearingDeg ? camera : { x: camera.x, y: camera.y, scale: camera.scale, bearingDeg }
}

/** Today's normalizeScreenMetrics. */
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
