// canvas/runtime/view/view-transform.ts  (pure)
//
// Owns the one ViewTransform (ADR 0016): the world-to-screen similarity every reader projects with, its inverse, quads, bulk
// anchors and ground resolution. Two builders anchor it: on MapLibre's geographic camera, or on the headless driver's
// PlanarCamera. At pitch 0 both are the same similarity, and at bearing 0 the planar one is today's arithmetic bit for bit.

import { mapZoomToStageScale } from '../../projection'
import type { SessionPlane } from '../../session-plane'
import { planarToViewCamera, viewCameraToPlanar } from './camera-math'
import { angularDistanceToNorth, bearingCosSin } from './navigation-policy'
import type {
  PlanarCamera,
  ScreenInsets,
  ScreenPoint,
  ViewCamera,
  ViewScreen,
  ViewTransform,
  WorldPoint,
  WorldQuad,
  WorldVector,
} from './types'

/** Under this angle from north the view reads as north-up (rulers, the compass hint). */
const NORTH_UP_TOLERANCE_DEG = 0.05
const NO_INSETS: ScreenInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

/** Pitch 0, geographic: centre, zoom and bearing + plane.mercatorOrigin / mercatorUnitsPerMeter → similarity. The MapLibre driver
 *  (whose truth is MapLibre's camera), the snapshot map's driver and the lens call this. */
export function buildViewTransform(input: {
  readonly camera: ViewCamera
  readonly screen: ViewScreen
  readonly plane: SessionPlane
  readonly planeRevision: number
  readonly revision: number
}): ViewTransform {
  return similarityTransform(input.camera, viewCameraToPlanar(input.camera, input.screen, input.plane), input)
}

/**
 * Pitch 0, planar: the headless driver's builder (ADR 0016, amended 2026-09-30). The similarity comes straight from the PlanarCamera;
 * at bearing 0 it is today's arithmetic (worldToScreen p × scale + { x, y }, screenToWorld (s − { x, y }) / scale, affine
 * [scale, 0, 0, scale, x, y], pixelsPerMetre = scale), so readbacks are bit for bit today's. `camera` is planarToViewCamera's.
 * At bearing 0 it agrees with buildViewTransform for the same camera within the contract tolerance (view/camera-contract.test.ts).
 */
export function buildViewTransformFromPlane(input: {
  readonly planar: PlanarCamera
  readonly screen: ViewScreen
  readonly plane: SessionPlane
  readonly planeRevision: number
  readonly revision: number
}): ViewTransform {
  const camera = planarToViewCamera(input.planar, input.screen, input.plane)
  return similarityTransform(Object.freeze({ ...camera, center: Object.freeze(camera.center) }), input.planar, input)
}

/** The PlanarCamera a pitch-0 transform places the plane with, from either builder: exact, since the builders keep its translation and scale. */
export function planarCameraOf(view: ViewTransform): PlanarCamera {
  const affine = view.planar?.affine
  if (!affine) throw new Error('A pitched view has no planar camera.')
  return { x: affine[4], y: affine[5], scale: view.pixelsPerMetre, bearingDeg: view.camera.bearingDeg }
}

// Pitch phase (not written now: no declaration, no stub; spec §6). When pitch ships, this module adds
//   homographyViewTransform(input: { camera, screen, plane, homography: Float64Array, planeRevision, revision }): ViewTransform

/** screen = turn(p × scale, bearing) + { x, y }: Pixi's [a, b, c, d, tx, ty] with a = d = scale·cos, c = −b = scale·sin. */
function similarityTransform(
  camera: ViewCamera,
  planar: PlanarCamera,
  input: { readonly screen: ViewScreen; readonly plane: SessionPlane; readonly planeRevision: number; readonly revision: number },
): ViewTransform {
  const { screen, plane } = input
  const { x: tx, y: ty, scale } = planar
  const [cos, sin] = bearingCosSin(planar.bearingDeg)
  // At bearing 0 every read below is today's CameraController expression, so readbacks match it bit for bit.
  const level = cos === 1 && sin === 0
  const a = level ? scale : scale * cos
  const b = level ? 0 : 0 - scale * sin
  const c = level ? 0 : scale * sin
  const d = a

  const worldToScreen = level
    ? (p: WorldPoint): ScreenPoint => ({ x: p.x * scale + tx, y: p.y * scale + ty })
    : (p: WorldPoint): ScreenPoint => ({ x: a * p.x + c * p.y + tx, y: b * p.x + d * p.y + ty })
  const screenToWorld = level
    ? (s: ScreenPoint): WorldPoint => ({ x: (s.x - tx) / scale, y: (s.y - ty) / scale })
    : (s: ScreenPoint): WorldPoint => {
        const across = (s.x - tx) / scale
        const down = (s.y - ty) / scale
        return { x: cos * across - sin * down, y: sin * across + cos * down }
      }
  const axes = Object.freeze({
    right: Object.freeze<WorldVector>({ x: level ? 1 : cos, y: level ? 0 : sin }),
    down: Object.freeze<WorldVector>({ x: level ? 0 : 0 - sin, y: level ? 1 : cos }),
  })

  const screenCorners = (insets: ScreenInsets): WorldQuad => {
    const left = insets.left
    const top = insets.top
    const right = screen.width - insets.right
    const bottom = screen.height - insets.bottom
    return [
      screenToWorld({ x: left, y: top }),
      screenToWorld({ x: right, y: top }),
      screenToWorld({ x: right, y: bottom }),
      screenToWorld({ x: left, y: bottom }),
    ]
  }

  return Object.freeze<ViewTransform>({
    revision: input.revision,
    planeRevision: input.planeRevision,
    camera,
    screen,
    planar: Object.freeze({
      affine: Object.freeze([a, b, c, d, tx, ty] as const),
    }),
    worldToScreen,
    screenToWorld,
    projectAnchors(world: Float64Array, out: Float32Array, count: number): void {
      for (let index = 0; index < count; index++) {
        const x = world[index * 2]!
        const y = world[index * 2 + 1]!
        out[index * 2] = level ? x * scale + tx : a * x + c * y + tx
        out[index * 2 + 1] = level ? y * scale + ty : b * x + d * y + ty
      }
    },
    metresPerPixelAt(p?: WorldPoint): number {
      const latitude = p ? plane.toGeo(p).lat : camera.center.lat
      return 1 / mapZoomToStageScale(camera.zoom, latitude)
    },
    screenDistance(from: WorldPoint, to: WorldPoint): number {
      return Math.hypot(to.x - from.x, to.y - from.y) * scale
    },
    screenAxesInWorld(): { readonly right: WorldVector; readonly down: WorldVector } {
      return axes
    },
    visibleWorldQuad(insets: ScreenInsets = NO_INSETS): WorldQuad {
      return screenCorners(insets)
    },
    worldQuadToScreen(q: WorldQuad): readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] {
      return [worldToScreen(q[0]), worldToScreen(q[1]), worldToScreen(q[2]), worldToScreen(q[3])]
    },
    pixelsPerMetre: scale,
    northUp: angularDistanceToNorth(camera.bearingDeg) < NORTH_UP_TOLERANCE_DEG && camera.pitchDeg === 0,
  })
}
