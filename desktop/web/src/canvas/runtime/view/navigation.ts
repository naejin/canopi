// canvas/runtime/view/navigation.ts  (the camera policy; the only user of CameraDriver; implements RotationSession from read-surface.ts)
//
// Owns how the view moves on command: zoom steps, the fits (Fit to Design, Return to Design, zoom to selection, the opening fit),
// the temporary-focus bookmark, jumps to a place or a camera, key turns, resets, turning to an edge, and rotation sessions. Every
// fit is oriented at its bearing (fit.ts) and lands as an exact 'place' move, so at bearing 0 a headless camera ends exactly where
// today's CameraController did.

import type { ScenePersistedState } from '../scene/types'
import type { CameraDriverHost, CameraMove } from './camera-driver'
import { planarCentredOn, rotatePlanarAround, screenToGeo } from './camera-math'
import { fitScene, fitTemporaryBounds, type FitExtent, type FitFrame } from './fit'
import {
  nextStep,
  normaliseBearing,
  roundToStep,
  scaleBoundsAt,
  shortestArc,
  snapBearing,
  VIEW_EASE_MS,
  type NavigationPolicy,
} from './navigation-policy'
import type { RotationSession, ViewCommandSurface } from './read-surface'
import type {
  PlanarCamera,
  SceneBounds,
  SceneBoundsOptions,
  ScreenInsets,
  ScreenPoint,
  TemporaryBoundsFocusOptions,
  ViewCamera,
  ViewTransform,
  WorldPoint,
} from './types'
import { planarCameraOf } from './view-transform'

export interface ViewNavigationDeps {
  readonly driver: CameraDriverHost                   // the only CameraDriver user
  readonly policy: () => NavigationPolicy
  /** The scene for zoomToFit, returnToDesign and zoomToSelection without arguments. */
  readonly readScene: () => { readonly persisted: ScenePersistedState; readonly selection: readonly WorldPoint[]; readonly bounds: SceneBoundsOptions }
}

export interface ViewNavigation extends ViewCommandSurface {
  /** Without arguments (the surface call) the navigation reads the current scene from its construction deps. */
  zoomToFit(scene?: ScenePersistedState, options?: SceneBoundsOptions): void   // keeps the bearing
  returnToDesign(scene?: ScenePersistedState, options?: SceneBoundsOptions): void
  /** Oriented at the current bearing: the box's four corners are fitted, not the box on screen axes. */
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean
  returnFromTemporaryFocus(): boolean        // bookmark is a ViewCamera: re-origin cannot invalidate it
  clearTemporaryFocus(): void
  centerOn(point: WorldPoint, pixelsPerMetre: number, options?: { readonly animate?: boolean; readonly bearingDeg?: number | 'keep' }): void
  /** Opening a Design: oriented fit at the given bearing. */
  openAt(scene: ScenePersistedState, bearingDeg: number): void

  // rotation
  turnToEdge(a: WorldPoint, b: WorldPoint): void   // smaller turn that makes a→b horizontal; never snapped
  beginRotation(pivot: ScreenPoint | 'centre'): RotationSession

  // gesture sinks (InputRouter only)
  panByPx(deltaPx: ScreenPoint): void
  zoomAroundPx(anchor: ScreenPoint, factor: number): void
}

/** Zoom in and zoom out: today's CameraController step about the screen centre. */
const ZOOM_STEP_FACTOR = 1.1
/** Return to Design's fallback frames this many metres across the shorter screen side, the plane origin centred. */
const RETURN_VIEW_METRES = 100
const ROTATION_STEP_DEG = 15
const NO_INSETS: ScreenInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

/** A view to go back to: exact while the plane is unchanged, geographic after a re-origin. */
interface Placement {
  readonly camera: ViewCamera
  readonly planar: PlanarCamera
  readonly planeRevision: number
}

/**
 * view/ cannot measure a scene (P4): a fit's extent is `options.extentPoints`, or the runtime's extent for the current scene from
 * `readScene`, so the `scene` arguments name the scene without being read.
 */
export function createViewNavigation(deps: ViewNavigationDeps): ViewNavigation {
  let bookmark: Placement | null = null
  /** The live rotation session; key turns and resets wait until it ends. */
  let rotation: object | null = null

  const frame = () => deps.driver.frames.viewFrame.peek()
  const driver = () => deps.driver.current()
  const apply = (move: CameraMove): void => driver().apply(move)
  const place = (planar: PlanarCamera): void => apply({ kind: 'place', planar })

  function screenCentre(): ScreenPoint {
    const { screen } = frame().view
    return { x: screen.width / 2, y: screen.height / 2 }
  }

  function placementNow(): Placement {
    const { view } = frame()
    return { camera: view.camera, planar: planarCameraOf(view), planeRevision: view.planeRevision }
  }

  function restore(placement: Placement): void {
    if (placement.planeRevision === frame().view.planeRevision) place(placement.planar)
    else apply({ kind: 'set', target: placement.camera, animation: 'none' })
  }

  function fitFrame(bearingDeg: number): FitFrame {
    const current = frame()
    const { view } = current
    return {
      screen: view.screen,
      insets: current.insets,
      scaleBounds: bearingDeg === view.camera.bearingDeg ? current.scaleBounds : scaleBoundsAt(view.screen, deps.policy(), bearingDeg),
      current: planarCameraOf(view),
    }
  }

  function extentOf(bounds: SceneBoundsOptions): FitExtent {
    return { extentPoints: bounds.extentPoints ?? (() => []), emptySceneScale: bounds.emptySceneScale }
  }

  /** A temporary focus's framing of `bounds` at the current bearing, or null when they cannot be framed. */
  function boundsFraming(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): PlanarCamera | null {
    const bearing = driver().bearingTarget()
    return fitTemporaryBounds(fitFrame(bearing), bounds, options, bearing)
  }

  function turnTo(bearingDeg: number): void {
    apply({ kind: 'rotate-around', anchorPx: 'centre', bearingDeg, animation: 'ease', durationMs: VIEW_EASE_MS })
  }

  function zoomAroundPx(anchor: ScreenPoint, factor: number): void {
    apply({ kind: 'zoom-around', anchorPx: anchor, factor })
  }

  return {
    zoomIn() {
      zoomAroundPx(screenCentre(), ZOOM_STEP_FACTOR)
    },
    zoomOut() {
      zoomAroundPx(screenCentre(), 1 / ZOOM_STEP_FACTOR)
    },
    zoomBy(factor) {
      if (!Number.isFinite(factor) || factor <= 0) return
      zoomAroundPx(screenCentre(), factor)
    },
    zoomToFit(_scene, options) {
      const bearing = driver().bearingTarget()
      place(fitScene(fitFrame(bearing), extentOf(options ?? deps.readScene().bounds), bearing))
    },
    zoomToSelection() {
      const points = deps.readScene().selection
      if (points.length === 0) return
      const bearing = driver().bearingTarget()
      place(fitScene(fitFrame(bearing), { extentPoints: () => points }, bearing))
    },
    returnToDesign(_scene, options) {
      // Today's rule: the fit when it reaches site scale and moves the view, else the plane origin centred at a usable scale.
      const bearing = driver().bearingTarget()
      const policy = deps.policy()
      const framing = fitFrame(bearing)
      const fitted = fitScene(framing, extentOf(options ?? deps.readScene().bounds), bearing)
      if (fitted.scale >= policy.overviewPixelsPerMetre && !samePlanar(fitted, framing.current)) {
        place(fitted)
        return
      }
      const { width, height } = framing.screen
      const scale = Math.min(framing.scaleBounds.max, Math.max(framing.scaleBounds.min, Math.min(width, height) / RETURN_VIEW_METRES))
      place({ x: width / 2, y: height / 2, scale: Math.max(policy.overviewPixelsPerMetre, scale), bearingDeg: bearing })
    },
    focusTemporaryBounds(bounds, options) {
      const focused = boundsFraming(bounds, options)
      if (!focused) return false
      // The latest focus wins: a return lands on the view this focus left.
      bookmark = placementNow()
      place(focused)
      return true
    },
    frameBounds(bounds, options) {
      const framed = boundsFraming(bounds, options)
      if (!framed) return false
      place(framed)
      return true
    },
    returnFromTemporaryFocus() {
      const saved = bookmark
      if (!saved) return false
      bookmark = null
      restore(saved)
      return true
    },
    clearTemporaryFocus() {
      bookmark = null
    },
    setFramingInsets(insets) {
      const valid = [insets.top, insets.right, insets.bottom, insets.left].every((edge) => Number.isFinite(edge) && edge >= 0)
      driver().setInsets(valid ? insets : NO_INSETS)
    },
    centerOn(point, pixelsPerMetre, options) {
      bookmark = null
      const bearing = options?.bearingDeg === undefined || options.bearingDeg === 'keep' ? driver().bearingTarget() : options.bearingDeg
      const { view, attached } = frame()
      const placement = planarCentredOn(view.screen, point, pixelsPerMetre, bearing)
      if (options?.animate && attached) {
        apply({ kind: 'set', target: cameraCentredOn(view, point, pixelsPerMetre, placement.bearingDeg), animation: 'fly' })
        return
      }
      place(placement)
    },
    openAt(_scene, bearingDeg) {
      if (!Number.isFinite(bearingDeg)) return
      bookmark = null
      const bearing = normaliseBearing(bearingDeg)
      const fitted = fitScene(fitFrame(bearing), extentOf(deps.readScene().bounds), bearing)
      place(fitted.bearingDeg === bearing ? fitted : rotatePlanarAround(fitted, frame().view.screen, 'centre', bearing))
    },
    showPlace(target, zoom, options) {
      if (![target.lon, target.lat, zoom].every(Number.isFinite)) return false
      bookmark = null
      apply({
        kind: 'set',
        target: { center: { lon: target.lon, lat: target.lat }, zoom, bearingDeg: driver().bearingTarget(), pitchDeg: 0 },
        animation: options?.motion === 'fly' ? 'fly' : 'none',
      })
      return true
    },
    showCamera(camera, options) {
      bookmark = null
      const motion = options?.motion ?? 'jump'
      apply({ kind: 'set', target: camera, animation: motion === 'jump' ? 'none' : motion })
    },
    resetNorth() {
      if (rotation || driver().bearingTarget() === 0) return
      turnTo(0)
    },
    rotateBy(direction) {
      if (rotation) return
      turnTo(nextStep(driver().bearingTarget(), direction, ROTATION_STEP_DEG))
    },
    turnToEdge(a, b) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      if (![dx, dy].every(Number.isFinite) || (dx === 0 && dy === 0)) return
      // At bearing β a plane vector turns counter-clockwise on screen by β, so a→b is level at atan2(dy, dx) and half a turn on.
      const along = normaliseBearing(Math.atan2(dy, dx) * 180 / Math.PI)
      const opposite = normaliseBearing(along + 180)
      const from = driver().bearingTarget()
      turnTo(Math.abs(shortestArc(from, along)) <= Math.abs(shortestArc(from, opposite)) ? along : opposite)
    },
    beginRotation(pivot) {
      driver().stopAnimation()
      const start = placementNow()
      const session = {}
      rotation = session
      const live = () => rotation === session
      return {
        update(totalDeltaDeg, { step }) {
          if (!live() || !Number.isFinite(totalDeltaDeg)) return
          const raw = start.camera.bearingDeg + totalDeltaDeg
          apply({
            kind: 'rotate-around',
            anchorPx: pivot,
            bearingDeg: step ? roundToStep(raw, ROTATION_STEP_DEG) : normaliseBearing(raw),
            animation: 'none',
          })
        },
        end() {
          if (!live()) return
          rotation = null
          const bearing = frame().view.camera.bearingDeg
          if (bearing !== 0 && snapBearing(bearing) === 0) {
            apply({ kind: 'rotate-around', anchorPx: pivot, bearingDeg: 0, animation: 'ease', durationMs: VIEW_EASE_MS })
          }
        },
        cancel() {
          if (!live()) return
          rotation = null
          restore(start)
        },
      }
    },
    panByPx(deltaPx) {
      apply({ kind: 'pan-by', deltaPx })
    },
    zoomAroundPx,
  }
}

/** The camera that shows a plane point at the screen centre at a scale and bearing, measured through the current view (a flight's target). */
function cameraCentredOn(view: ViewTransform, point: WorldPoint, pixelsPerMetre: number, bearingDeg: number): ViewCamera {
  return {
    center: screenToGeo(view.camera, view.screen, view.worldToScreen(point)),
    zoom: view.camera.zoom + Math.log2(pixelsPerMetre / view.pixelsPerMetre),
    bearingDeg,
    pitchDeg: 0,
  }
}

function samePlanar(a: PlanarCamera, b: PlanarCamera): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale && a.bearingDeg === b.bearingDeg
}
