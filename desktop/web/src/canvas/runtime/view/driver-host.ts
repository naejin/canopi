// canvas/runtime/view/driver-host.ts  (pure; the clock, animation frames and timers are injected)
//
// Owns the runtime's one camera across attach, detach and failure (ADR 0016): the live CameraDriver (a HeadlessCameraDriver until a
// map is attached, and again after a detach or a failure), the NavigationPolicy every driver on it reads, and the one frame stream
// readers subscribe to. The host relays the live driver's frames with its own revisions, so revisions and plane revisions stay
// monotonic across swaps, and marks them attached while an attached driver is live.

import { signal, type ReadonlySignal } from '@preact/signals'
import type { SessionPlane } from '../../session-plane'
import type { WorkspaceCameraPolicy } from '../../workspace-camera-policy'
import type { CameraDriver, CameraDriverDeps, CameraDriverFailure, CameraDriverHost } from './camera-driver'
import { viewCameraToPlanar } from './camera-math'
import { createViewFrameSource } from './frame-source'
import { createHeadlessCameraDriver } from './headless-driver'
import { createNavigationPolicy, type NavigationPolicy } from './navigation-policy'
import type { FrameSourceDeps, PlanarCamera, ScreenInsets, ViewFrame, ViewScreen } from './types'

export interface CameraDriverHostOptions {
  readonly clock: () => number
  readonly scheduleFrame: CameraDriverDeps['scheduleFrame']
  /** The settle timers of the host's frames and of its headless drivers. */
  readonly timers: FrameSourceDeps['timers']
  readonly policy: WorkspaceCameraPolicy
  readonly reducedMotion: ReadonlySignal<boolean>
  /** The session plane the runtime works in: headless drivers are built on it, and planeChanged is called with it after a re-origin. */
  readonly plane: () => SessionPlane
  /** Default: an empty screen at density 1, as today's CameraController before initialize. */
  readonly screen?: ViewScreen
  /** Default: today's unpublished CameraController placement, { x: 0, y: 0, scale: 1 } at bearing 0. */
  readonly camera?: PlanarCamera
  readonly insets?: ScreenInsets
}

export interface CameraDriverHostController extends CameraDriverHost {
  /** What every driver on this host runs with: an attached driver is built with them, and navigation reads `policy` from them. */
  readonly driverDeps: CameraDriverDeps
  dispose(): void
}

const EMPTY_SCREEN: ViewScreen = Object.freeze({ width: 0, height: 0, devicePixelRatio: 1 })
const TODAY_UNPUBLISHED_CAMERA: PlanarCamera = Object.freeze({ x: 0, y: 0, scale: 1, bearingDeg: 0 })

export function createCameraDriverHost(options: CameraDriverHostOptions): CameraDriverHostController {
  let navigationPolicy: NavigationPolicy = createNavigationPolicy(options.policy, options.reducedMotion)
  const driverDeps: CameraDriverDeps = Object.freeze({
    clock: options.clock,
    scheduleFrame: options.scheduleFrame,
    policy: () => navigationPolicy,
  })
  const failure = signal<CameraDriverFailure | null>(null)

  let live: CameraDriver = createHeadlessCameraDriver({
    deps: driverDeps,
    timers: options.timers,
    plane: options.plane(),
    screen: options.screen ?? EMPTY_SCREEN,
    camera: options.camera ?? TODAY_UNPUBLISHED_CAMERA,
    insets: options.insets,
  })
  let attached = false
  let revision = 0
  let planeRevision = 0
  let relayedDriver = live
  let relayedDriverPlaneRevision = live.frames.viewFrame.peek().view.planeRevision
  let relayedPlane = options.plane()
  let disposed = false
  let release = connect(live)

  const frames = createViewFrameSource(stamp(live.frames.viewFrame.peek()), { clock: options.clock, timers: options.timers })

  function stamp(frame: ViewFrame): ViewFrame {
    const view = Object.freeze({ ...frame.view, revision, planeRevision })
    return Object.freeze<ViewFrame>({ ...frame, view, attached, revision })
  }

  /** Relays one frame of the live driver. The plane revision moves when the driver re-origins, or when a swap finds a new plane. */
  function relay(driver: CameraDriver, frame: ViewFrame): void {
    if (disposed || driver !== live) return
    const plane = options.plane()
    const planeMoved = driver === relayedDriver
      ? frame.view.planeRevision !== relayedDriverPlaneRevision
      : plane !== relayedPlane
    if (planeMoved) planeRevision += 1
    relayedDriver = driver
    relayedDriverPlaneRevision = frame.view.planeRevision
    relayedPlane = plane
    revision += 1
    frames.publish(stamp(frame))
  }

  function connect(driver: CameraDriver): () => void {
    const stopRelay = driver.frames.onViewFrame('tools', (frame) => relay(driver, frame))
    let connecting = true
    const stopFailure = driver.failure.subscribe((reported) => {
      if (!connecting && reported && driver === live && attached) fail(reported)
    })
    connecting = false
    return () => {
      stopRelay()
      stopFailure()
    }
  }

  /**
   * Swaps the live driver: `prepare` brings the new one to the last frame's camera unrelayed, then the host publishes one frame. An
   * attached driver that fails meanwhile is never relayed: the host detaches at the camera it had.
   */
  function swapTo(driver: CameraDriver, nextAttached: boolean, prepare: () => void): void {
    release()
    release = () => {}
    live.dispose()
    live = driver
    attached = nextAttached
    prepare()
    const reported = driver.failure.peek()
    if (reported) {
      fail(reported)
      return
    }
    release = connect(driver)
    relay(driver, driver.frames.viewFrame.peek())
  }

  function detachTo(): void {
    const last = frames.viewFrame.peek()
    const plane = options.plane()
    const { screen } = last.view
    swapTo(createHeadlessCameraDriver({
      deps: driverDeps,
      timers: options.timers,
      plane,
      screen,
      camera: viewCameraToPlanar(last.view.camera, screen, plane),
      insets: last.insets,
    }), false, () => {})
  }

  function fail(reported: CameraDriverFailure): void {
    detachTo()
    failure.value = reported
  }

  return {
    frames,
    driverDeps,
    failure,
    current: () => live,
    attach(driver) {
      if (disposed) return
      const refused = driver.failure.peek()
      if (refused) {
        // Built failed (a map it cannot drive): it never takes the camera.
        driver.dispose()
        if (attached) detachTo()
        failure.value = refused
        return
      }
      const last = frames.viewFrame.peek()
      failure.value = null
      swapTo(driver, true, () => {
        driver.setInsets(last.insets)
        driver.apply({ kind: 'set', target: last.view.camera, animation: 'none' })
      })
    },
    detach() {
      if (disposed || !attached) return
      detachTo()
    },
    replacePolicy(policy) {
      if (disposed) return
      navigationPolicy = createNavigationPolicy(policy, options.reducedMotion)
      // Today's applyPolicy: the scale clamps to the new bounds about the screen centre, and the frame takes the new bounds.
      const { screen } = frames.viewFrame.peek().view
      live.apply({ kind: 'zoom-around', anchorPx: { x: screen.width / 2, y: screen.height / 2 }, factor: 1 })
    },
    dispose() {
      if (disposed) return
      disposed = true
      release()
      live.dispose()
      frames.dispose()
    },
  }
}
