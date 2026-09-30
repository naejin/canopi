// The headless and MapLibre camera paths against MapLibre's own MercatorTransform (ADR 0016): the same camera script runs
// through the PlanarCamera arithmetic the headless driver keeps and through the geographic targets the MapLibre driver sends,
// and every frame must project like MapLibre's transform to 1e-6 px. The source is loaded through the test-only
// `maplibre-gl-source` alias (desktop/web/vite.config.ts; plan 0A "Contract test source"). Float rounding sets the zooms:
// MapLibre's own matrices round by up to 5e-7 px at zoom 22, and the geographic path rounds its centre to lon/lat doubles on
// every move (about 1e-7 px per move at zoom 21.6, latitude 60), so single frames go up to zoom 22 and scripts stay under 20.

import { signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { LngLat as SourceLngLatClass } from 'maplibre-gl-source/geo/lng_lat.ts'
import { MercatorTransform as SourceMercatorTransform } from 'maplibre-gl-source/geo/projection/mercator_transform.ts'
import { mapZoomToStageScale } from '../../projection'
import { createSessionPlane, type SessionPlane } from '../../session-plane'
import { createWorkspaceCameraPolicy } from '../../workspace-camera-policy'
import {
  cameraKeepingPoint,
  panCamera,
  panPlanar,
  planarToViewCamera,
  rotateCameraAround,
  rotatePlanarAround,
  zoomCameraAround,
  zoomPlanarToScale,
} from './camera-math'
import { constrainCamera, createNavigationPolicy, normaliseBearing } from './navigation-policy'
import type { PlanarCamera, ScreenPoint, ViewCamera, ViewScreen, ViewTransform, WorldPoint } from './types'
import { buildViewTransform, buildViewTransformFromPlane } from './view-transform'

/** The members of MapLibre's LngLat and MercatorTransform this test calls. */
interface SourceLngLat { readonly lng: number; readonly lat: number }
interface SourceTransform {
  resize(width: number, height: number): void
  setBearing(bearing: number): void
  setZoom(zoom: number): void
  setCenter(center: SourceLngLat): void
  setConstrainOverride(constrain: ((center: SourceLngLat, zoom: number) => { center: SourceLngLat; zoom: number }) | null): void
  readonly center: SourceLngLat
  readonly zoom: number
  readonly bearing: number
  locationToScreenPoint(location: SourceLngLat): ScreenPoint
}
const LngLat = SourceLngLatClass as new (lng: number, lat: number) => SourceLngLat
const MercatorTransform = SourceMercatorTransform as new (options: {
  readonly minZoom: number
  readonly maxZoom: number
  readonly renderWorldCopies: boolean
}) => SourceTransform

const TOLERANCE_PX = 1e-6
const SCREEN: ViewScreen = { width: 900, height: 600, devicePixelRatio: 1 }
const POLICY = createNavigationPolicy(createWorkspaceCameraPolicy(), signal(false))

/** A MercatorTransform with the same constrain the MapLibre driver installs, for the bearing it is about to set. */
function mapLibreTransform(screen: ViewScreen): { transform: SourceTransform; show(camera: ViewCamera): ViewCamera } {
  const transform = new MercatorTransform({ minZoom: POLICY.minZoom, maxZoom: POLICY.maxZoom, renderWorldCopies: false })
  transform.resize(screen.width, screen.height)
  let bearingDeg = 0
  transform.setConstrainOverride((center, zoom) => {
    const constrained = constrainCamera(
      { center: { lon: center.lng, lat: center.lat }, zoom, bearingDeg, pitchDeg: 0 },
      screen,
      POLICY,
    )
    return { center: new LngLat(constrained.center.lon, constrained.center.lat), zoom: constrained.zoom }
  })
  return {
    transform,
    show(camera) {
      bearingDeg = camera.bearingDeg
      transform.setBearing(camera.bearingDeg)
      transform.setZoom(camera.zoom)
      transform.setCenter(new LngLat(camera.center.lon, camera.center.lat))
      return {
        center: { lon: transform.center.lng, lat: transform.center.lat },
        zoom: transform.zoom,
        bearingDeg: normaliseBearing(transform.bearing),
        pitchDeg: 0,
      }
    },
  }
}

/** Plane points spread over the screen and a little beyond it. */
function samplePoints(view: ViewTransform): WorldPoint[] {
  const points: WorldPoint[] = []
  for (const x of [-0.5, 0, 0.25, 0.5, 0.75, 1, 1.1]) {
    for (const y of [-0.2, 0, 0.3, 0.5, 1]) {
      points.push(view.screenToWorld({ x: x * view.screen.width, y: y * view.screen.height })!)
    }
  }
  return points
}

/**
 * Both directions are held to MapLibre's forward projection. Its own screenPointToLocation inverts a 4×4 perspective matrix
 * and drifts from locationToScreenPoint by up to about 1e-5 px at zoom 22, so it is not the reference.
 */
function expectProjectsLikeMapLibre(view: ViewTransform, transform: SourceTransform, plane: SessionPlane): void {
  const project = (point: WorldPoint): ScreenPoint => {
    const ground = plane.toGeo(point)
    return transform.locationToScreenPoint(new LngLat(ground.lon, ground.lat))
  }
  for (const point of samplePoints(view)) {
    const expected = project(point)
    const actual = view.worldToScreen(point)
    expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(TOLERANCE_PX)
    expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(TOLERANCE_PX)

    const screenPoint = { x: actual.x + 0.375, y: actual.y - 0.625 }
    const underIt = project(view.screenToWorld(screenPoint)!)
    expect(Math.abs(underIt.x - screenPoint.x)).toBeLessThanOrEqual(TOLERANCE_PX)
    expect(Math.abs(underIt.y - screenPoint.y)).toBeLessThanOrEqual(TOLERANCE_PX)
  }
}

type ScriptMove =
  | { readonly kind: 'pan-by'; readonly deltaPx: ScreenPoint }
  | { readonly kind: 'zoom-around'; readonly anchorPx: ScreenPoint; readonly factor: number }
  | { readonly kind: 'rotate-around'; readonly anchorPx: ScreenPoint | 'centre'; readonly bearingDeg: number }

const SCRIPT: readonly ScriptMove[] = [
  { kind: 'pan-by', deltaPx: { x: 10, y: -7 } },
  { kind: 'zoom-around', anchorPx: { x: 120, y: 80 }, factor: 1.5 },
  { kind: 'rotate-around', anchorPx: { x: 300, y: 50 }, bearingDeg: 30 },
  { kind: 'pan-by', deltaPx: { x: -40.5, y: 25.25 } },
  { kind: 'zoom-around', anchorPx: { x: 50, y: 550 }, factor: 0.8 },
  { kind: 'rotate-around', anchorPx: 'centre', bearingDeg: 300 },
  { kind: 'zoom-around', anchorPx: { x: 700, y: 20 }, factor: 3.2 },
  { kind: 'rotate-around', anchorPx: { x: 10, y: 590 }, bearingDeg: 181.5 },
  { kind: 'pan-by', deltaPx: { x: 333, y: -111 } },
  { kind: 'rotate-around', anchorPx: { x: 890, y: 300 }, bearingDeg: 0 },
  { kind: 'zoom-around', anchorPx: { x: 450, y: 300 }, factor: 0.5 },
]

function movePlanar(camera: PlanarCamera, move: ScriptMove): PlanarCamera {
  switch (move.kind) {
    case 'pan-by': return panPlanar(camera, move.deltaPx)
    case 'zoom-around': return zoomPlanarToScale(camera, move.anchorPx, camera.scale * move.factor)
    case 'rotate-around': return rotatePlanarAround(camera, SCREEN, move.anchorPx, move.bearingDeg)
  }
}

function moveGeographic(camera: ViewCamera, move: ScriptMove): ViewCamera {
  switch (move.kind) {
    case 'pan-by': return panCamera(camera, SCREEN, move.deltaPx)
    case 'zoom-around': return zoomCameraAround(camera, SCREEN, move.anchorPx, move.factor)
    case 'rotate-around': return rotateCameraAround(camera, SCREEN, move.anchorPx, move.bearingDeg)
  }
}

describe('camera contract', () => {
  it('headless and MercatorTransform agree for pan, zoom and rotate moves', () => {
    const starts = [
      { origin: { lon: 2.3522, lat: 48.8566 }, zoom: 18 },
      { origin: { lon: -70.65, lat: -33.45 }, zoom: 16.4 },
      { origin: { lon: 151.2, lat: 60 }, zoom: 17.2 },
    ]
    for (const start of starts) {
      const plane = createSessionPlane(start.origin)
      const scale = mapZoomToStageScale(start.zoom, plane.origin.lat)
      let planar: PlanarCamera = { x: SCREEN.width / 2 - 25 * scale, y: SCREEN.height / 2 + 12 * scale, scale, bearingDeg: 0 }
      let geographic = planarToViewCamera(planar, SCREEN, plane)
      const map = mapLibreTransform(SCREEN)

      for (const move of SCRIPT) {
        planar = movePlanar(planar, move)
        geographic = constrainCamera(moveGeographic(geographic, move), SCREEN, POLICY)
        const shown = map.show(geographic)

        // MapLibre keeps the target the driver sends: it is already constrained.
        expect(shown.center.lon).toBe(geographic.center.lon)
        expect(shown.center.lat).toBe(geographic.center.lat)
        expect(shown.zoom).toBe(geographic.zoom)
        expect(Math.abs(shown.bearingDeg - geographic.bearingDeg)).toBeLessThan(1e-9)
        expect(planar.bearingDeg).toBe(geographic.bearingDeg)

        const headless = buildViewTransformFromPlane({ planar, screen: SCREEN, plane, planeRevision: 1, revision: 1 })
        const attached = buildViewTransform({ camera: shown, screen: SCREEN, plane, planeRevision: 1, revision: 1 })
        expectProjectsLikeMapLibre(headless, map.transform, plane)
        expectProjectsLikeMapLibre(attached, map.transform, plane)
      }
    }
  })

  it('a camera keeping a ground point puts it under the screen point on MercatorTransform', () => {
    const plane = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    const ground = { lon: 2.3531, lat: 48.8559 }
    for (const bearingDeg of [0, 30, 181.5]) {
      const start = constrainCamera({ center: plane.origin, zoom: 17.5, bearingDeg, pitchDeg: 0 }, SCREEN, POLICY)
      for (const screenPoint of [{ x: 450, y: 300 }, { x: 12.5, y: 580 }, { x: 870, y: 40 }]) {
        const kept = cameraKeepingPoint(start, SCREEN, ground, screenPoint)
        expect(kept.zoom).toBe(start.zoom)
        expect(kept.bearingDeg).toBe(start.bearingDeg)

        const map = mapLibreTransform(SCREEN)
        expect(map.show(kept).center).toEqual(kept.center)
        const underPoint = map.transform.locationToScreenPoint(new LngLat(ground.lon, ground.lat))
        expect(Math.abs(underPoint.x - screenPoint.x)).toBeLessThanOrEqual(TOLERANCE_PX)
        expect(Math.abs(underPoint.y - screenPoint.y)).toBeLessThanOrEqual(TOLERANCE_PX)
      }
    }
  })

  it('the planar and geographic builders agree at bearing 0', () => {
    const origins = [{ lon: 0, lat: 0 }, { lon: 2.3522, lat: 48.8566 }, { lon: -58.4, lat: -34.6 }, { lon: 24.9, lat: 60.2 }]
    for (const origin of origins) {
      const plane = createSessionPlane(origin)
      for (const zoom of [3, 10.5, 16.25, 20, 22]) {
        const scale = mapZoomToStageScale(zoom, origin.lat)
        for (const offset of [{ x: 0, y: 0 }, { x: 83.05, y: -41.25 }, { x: -270, y: 180 }]) {
          const planar = { x: SCREEN.width / 2 + offset.x, y: SCREEN.height / 2 + offset.y, scale, bearingDeg: 0 }
          const headless = buildViewTransformFromPlane({ planar, screen: SCREEN, plane, planeRevision: 1, revision: 1 })
          const geographic = buildViewTransform({ camera: headless.camera, screen: SCREEN, plane, planeRevision: 1, revision: 1 })

          expect(geographic.camera).toBe(headless.camera)
          expect(Math.abs(geographic.pixelsPerMetre / headless.pixelsPerMetre - 1)).toBeLessThan(1e-12)
          for (const point of samplePoints(headless)) {
            const fromPlane = headless.worldToScreen(point)
            const fromCamera = geographic.worldToScreen(point)
            expect(Math.abs(fromPlane.x - fromCamera.x)).toBeLessThanOrEqual(TOLERANCE_PX)
            expect(Math.abs(fromPlane.y - fromCamera.y)).toBeLessThanOrEqual(TOLERANCE_PX)
          }
          const map = mapLibreTransform(SCREEN)
          map.show(headless.camera)
          expectProjectsLikeMapLibre(headless, map.transform, plane)
          expectProjectsLikeMapLibre(geographic, map.transform, plane)
        }
      }
    }
  })
})
