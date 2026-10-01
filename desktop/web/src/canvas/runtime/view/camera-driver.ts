// canvas/runtime/view/camera-driver.ts  (types)

import type { ReadonlySignal } from '@preact/signals'
import type { SessionPlane } from '../../session-plane'
import type { WorkspaceCameraPolicy } from '../../workspace-camera-policy'
import type { NavigationPolicy } from './navigation-policy'
import type { DriverFrameSource, PlanarCamera, ScreenInsets, ScreenPoint, ViewCamera, ViewFrameSource, ViewScreen } from './types'

export type CameraMove =
  /** deltaPx is content movement: the ground under the pointer moves by deltaPx. New centre = unproject(screenCentre − deltaPx). */
  | { readonly kind: 'pan-by'; readonly deltaPx: ScreenPoint }
  | { readonly kind: 'zoom-around'; readonly anchorPx: ScreenPoint; readonly factor: number }
  /**
   * Keep the ground under anchorPx fixed while the bearing changes; the centre is an output.
   * 'ease' runs a driver tween (durationMs, default 300) about the same anchor.
   */
  | {
      readonly kind: 'rotate-around'
      readonly anchorPx: ScreenPoint | 'centre'
      readonly bearingDeg: number
      readonly animation: 'none' | 'ease'
      readonly durationMs?: number
    }
  /** Go to a full camera. The centre is an input; no anchor. 'ease' is a driver tween; 'fly' is MapLibre flyTo. */
  | {
      readonly kind: 'set'
      readonly target: ViewCamera               // pitchDeg: 0 by type
      readonly animation: 'none' | 'ease' | 'fly'
      readonly durationMs?: number              // ease: 300 default
    }
  /**
   * setViewport's exact placement (createTestView, and the legacy facade's setViewport and reprojectViewport). The headless driver
   * clamps the scale as today and adopts the rest bit for bit; the MapLibre driver converts it to a ViewCamera through the plane once
   * and jumps.
   */
  | { readonly kind: 'place'; readonly planar: PlanarCamera }

export interface CameraDriver {
  readonly frames: DriverFrameSource
  /** Synchronous for 'none' moves and the incremental kinds: `frames.viewFrame` is current on return (unless queued). */
  apply(move: CameraMove): void
  /** The bearing a running tween or flight will end at, else the live bearing. */
  bearingTarget(): number
  stopAnimation(): void
  /** Re-origin and the attached refreshOrigin only (hydration keeps the plane camera): the MapLibre driver rebuilds against the new
   *  plane; the headless driver applies old.transformTo(new) to its PlanarCamera in plane terms, no lon/lat (today's
   *  reprojectPlaneViewport, exact at bearing 0). */
  planeChanged(plane: SessionPlane): void
  setScreen(screen: ViewScreen): void
  setInsets(insets: ScreenInsets): void
  /** Set when the driver can no longer drive its camera (the MapLibre driver: 'map-lost', 'map-error'); the host it is attached to
   *  detaches and reports it as its own failure. Always null on the headless driver. */
  readonly failure: ReadonlySignal<CameraDriverFailure | null>
  dispose(): void
}

/** Injected into both drivers (P4: no clock, timer or requestAnimationFrame in view/). */
export interface CameraDriverDeps {
  readonly clock: () => number
  /** One animation-frame callback; returns its canceller. Tests step it by hand. */
  readonly scheduleFrame: (cb: (nowMs: number) => void) => () => void
  readonly policy: () => NavigationPolicy
}

export interface CameraDriverFailure { readonly reason: 'map-lost' | 'agreement' | 'map-error'; readonly message: string }

/**
 * Owns the runtime's one camera across attach, detach and failure; replaces CameraController's detached mode.
 * The runtime starts on a HeadlessCameraDriver (tests, before attach). `frames` is stable across swaps.
 */
export interface CameraDriverHost {
  readonly frames: ViewFrameSource
  readonly current: () => CameraDriver
  /** Hands the camera to an attached driver: it starts with a 'set'/'none' move to the current camera; ViewFrame.attached becomes true. */
  attach(driver: CameraDriver): void
  /** Back to a HeadlessCameraDriver at the last camera; ViewFrame.attached becomes false. */
  detach(): void
  /** Today's replacePolicy (a new session-plane latitude): the host rebuilds its NavigationPolicy from it and re-constrains the current camera.
   *  While a tween or flight runs (the frame is moving) it sends no move: the driver constrains its next frame under the new policy,
   *  so a re-origin during a flight never stops it. */
  replacePolicy(policy: WorkspaceCameraPolicy): void
  /** The Scene's plane on hydration and on a detached re-origin: a live headless driver keeps its plane placement and takes the new
   *  plane (a headless re-origin is followPlane plus a 'place' move, the same numbers as planeChanged, which only the attached
   *  refreshOrigin calls). The runtime calls it; without it the headless camera would report another plane's ground. */
  followPlane(plane: SessionPlane): void
  /** The deps the host built its drivers with; the activation builds the MapLibre driver with them. */
  readonly driverDeps: CameraDriverDeps
  /** Set when the attached driver fails; the host has already detached. */
  readonly failure: ReadonlySignal<CameraDriverFailure | null>
}
