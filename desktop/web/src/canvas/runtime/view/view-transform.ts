// canvas/runtime/view/view-transform.ts  (pure)
//
// Owns the one ViewTransform (ADR 0016): the world-to-screen similarity every reader projects with, its inverse, quads, bulk
// anchors and ground resolution, built from a geographic camera (both drivers' truth) and the session plane.

import { mapZoomToStageScale } from '../../projection'
import type { SessionPlane } from '../../session-plane'
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

/** Pitch 0: centre, zoom and bearing + plane.mercatorOrigin / mercatorUnitsPerMeter → similarity. Both drivers, the snapshot map's
 *  driver and the lens call this. The plane origin lands at turn(−centre × scale, bearing) + the screen centre. */
export function buildViewTransform(input: {
  readonly camera: ViewCamera
  readonly screen: ViewScreen
  readonly plane: SessionPlane
  readonly planeRevision: number
  readonly revision: number
}): ViewTransform {
  const { camera, screen, plane } = input
  const scale = mapZoomToStageScale(camera.zoom, plane.origin.lat)
  const centre = plane.toPlane(camera.center)
  const [cos, sin] = bearingCosSin(camera.bearingDeg)
  const placement: PlanarCamera = {
    x: screen.width / 2 - (cos * centre.x + sin * centre.y) * scale,
    y: screen.height / 2 - (cos * centre.y - sin * centre.x) * scale,
    scale,
    bearingDeg: camera.bearingDeg,
  }
  return similarityTransform(camera, placement, input)
}

/** The PlanarCamera a pitch-0 transform places the plane with (the chrome and the test view read it). */
export function planarCameraOf(view: ViewTransform): PlanarCamera {
  const { affine } = view.planar
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
  const a = scale * cos
  const b = 0 - scale * sin
  const c = scale * sin
  const d = a

  const worldToScreen = (p: WorldPoint): ScreenPoint => ({ x: a * p.x + c * p.y + tx, y: b * p.x + d * p.y + ty })
  const screenToWorld = (s: ScreenPoint): WorldPoint => {
    const across = (s.x - tx) / scale
    const down = (s.y - ty) / scale
    return { x: cos * across - sin * down, y: sin * across + cos * down }
  }
  const axes = Object.freeze({
    right: Object.freeze<WorldVector>({ x: cos, y: sin }),
    down: Object.freeze<WorldVector>({ x: 0 - sin, y: cos }),
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
        out[index * 2] = a * x + c * y + tx
        out[index * 2 + 1] = b * x + d * y + ty
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
