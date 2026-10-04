import { signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { geoToMercator, MAPLIBRE_WORLD_TILE_SIZE } from '../../projection'
import { singleWorldEffectiveMinimumZoom } from '../../workspace-camera-policy'
import {
  angularDistanceToNorth,
  constrainCamera,
  createNavigationPolicy,
  nextStep,
  normaliseBearing,
  roundToStep,
  shortestArc,
  snapBearing,
  zoomFloorForArc,
} from './navigation-policy'
import type { ViewCamera, ViewScreen } from './types'

const POLICY = createNavigationPolicy(0, signal(false))
const LANDSCAPE: ViewScreen = { width: 1000, height: 800, devicePixelRatio: 1 }
const PORTRAIT: ViewScreen = { width: 700, height: 2000, devicePixelRatio: 2 }
const SMALL: ViewScreen = { width: 400, height: 300, devicePixelRatio: 1 }

function camera(lon: number, lat: number, zoom: number, bearingDeg: number): ViewCamera {
  return { center: { lon, lat }, zoom, bearingDeg, pitchDeg: 0 }
}

/** The four screen corners on the Mercator square [0, 1]², computed here, not with the view module's maths. */
function groundCornersMercator(view: ViewCamera, screen: ViewScreen): Array<{ x: number; y: number }> {
  const centre = geoToMercator(view.center.lon, view.center.lat)
  const worldSize = MAPLIBRE_WORLD_TILE_SIZE * 2 ** view.zoom
  const radians = view.bearingDeg * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [[0, 0], [screen.width, 0], [screen.width, screen.height], [0, screen.height]].map(([x, y]) => {
    const dx = x! - screen.width / 2
    const dy = y! - screen.height / 2
    return { x: centre.x + (cos * dx - sin * dy) / worldSize, y: centre.y + (sin * dx + cos * dy) / worldSize }
  })
}

function expectInsideOneWorld(view: ViewCamera, screen: ViewScreen): void {
  for (const corner of groundCornersMercator(view, screen)) {
    expect(corner.x).toBeGreaterThanOrEqual(-1e-9)
    expect(corner.x).toBeLessThanOrEqual(1 + 1e-9)
    expect(corner.y).toBeGreaterThanOrEqual(-1e-9)
    expect(corner.y).toBeLessThanOrEqual(1 + 1e-9)
  }
}

describe('navigation policy', () => {
  it('is built from the workspace camera limits at the reference latitude', () => {
    const reducedMotion = signal(true)
    const policy = createNavigationPolicy(48.85, reducedMotion)

    expect(policy).toMatchObject({
      referenceLatitudeDeg: 48.85,
      minZoom: 0,
      maxZoom: 27,
      overviewPixelsPerMetre: 0.1,
    })
    expect(policy.reducedMotion).toBe(reducedMotion)
    expect(Object.isFrozen(policy)).toBe(true)
  })

  it('constrain at world zoom for bearings 0, 45 and 90', () => {
    const cases = [
      { bearingDeg: 0, boxSide: 1000 },
      { bearingDeg: 45, boxSide: 1800 * Math.SQRT1_2 },
      { bearingDeg: 90, boxSide: 1000 },
    ]
    for (const { bearingDeg, boxSide } of cases) {
      const constrained = constrainCamera(camera(170, 80, 0, bearingDeg), LANDSCAPE, POLICY)

      expect(constrained.zoom).toBeCloseTo(Math.log2(boxSide / MAPLIBRE_WORLD_TILE_SIZE), 12)
      expect(constrained.zoom).toBe(zoomFloorForArc(LANDSCAPE, POLICY, bearingDeg, bearingDeg))
      expect(constrained.bearingDeg).toBe(bearingDeg)
      expectInsideOneWorld(constrained, LANDSCAPE)
    }
    // At the floor the box's larger side is the whole world, so that axis is centred on the world.
    expect(constrainCamera(camera(170, 80, 0, 0), LANDSCAPE, POLICY).center.lon).toBeCloseTo(0, 9)
    expect(constrainCamera(camera(170, 80, 0, 90), LANDSCAPE, POLICY).center.lat).toBeCloseTo(0, 9)
  })

  it('a rotate-only move at bearing 45 is constrained', () => {
    const atNorth = constrainCamera(camera(0, 0, 0, 0), LANDSCAPE, POLICY)
    expect(constrainCamera(atNorth, LANDSCAPE, POLICY)).toBe(atNorth)

    const turned = constrainCamera({ ...atNorth, bearingDeg: 45 }, LANDSCAPE, POLICY)

    expect(turned.zoom).toBeGreaterThan(atNorth.zoom)
    expect(turned.zoom).toBe(zoomFloorForArc(LANDSCAPE, POLICY, 45, 45))
    expect(turned.bearingDeg).toBe(45)
    expectInsideOneWorld(turned, LANDSCAPE)
    // Without the constrain, the turned screen's corners leave the world.
    expect(groundCornersMercator({ ...atNorth, bearingDeg: 45 }, LANDSCAPE).some(({ x, y }) => x < 0 || y < 0 || x > 1 || y > 1)).toBe(true)
  })

  it('constrain is idempotent', () => {
    const screens = [SMALL, LANDSCAPE, PORTRAIT, { width: 0, height: 0, devicePixelRatio: 1 }]
    for (const screen of screens) {
      for (const zoom of [-3, 0, 0.7, 5, 30]) {
        for (const lon of [-250, -179.99, 0, 13.4, 179.99, 400]) {
          for (const lat of [-89, -60, 0, 85.05, 89]) {
            for (const bearingDeg of [0, 30, 45, 90, 200, 359.5]) {
              const once = constrainCamera(camera(lon, lat, zoom, bearingDeg), screen, POLICY)
              expect(constrainCamera(once, screen, POLICY)).toBe(once)
              const arc = { fromDeg: bearingDeg, toDeg: bearingDeg + 70 }
              const onceOverArc = constrainCamera(camera(lon, lat, zoom, bearingDeg), screen, POLICY, arc)
              expect(constrainCamera(onceOverArc, screen, POLICY, arc)).toBe(onceOverArc)
            }
          }
        }
      }
    }
  })

  it('constrain clamps zoom to the policy range and holds longitude inside one world', () => {
    expect(constrainCamera(camera(0, 0, 30, 0), SMALL, POLICY).zoom).toBe(27)
    expect(constrainCamera(camera(0, 0, -2, 0), SMALL, POLICY).zoom).toBe(0)

    const pastTheAntimeridian = constrainCamera(camera(200, 10, 5, 0), SMALL, POLICY)
    expect(pastTheAntimeridian.zoom).toBe(5)
    expect(pastTheAntimeridian.center.lon).toBeLessThan(180)
    expectInsideOneWorld(pastTheAntimeridian, SMALL)
    const east = groundCornersMercator(pastTheAntimeridian, SMALL)[1]!
    expect(east.x).toBeCloseTo(1, 12)

    const westOfTheWorld = constrainCamera(camera(-181, -10, 5, 30), SMALL, POLICY)
    expect(westOfTheWorld.center.lon).toBeGreaterThan(-180)
    expectInsideOneWorld(westOfTheWorld, SMALL)

    const pastThePole = constrainCamera(camera(0, 89, 5, 0), SMALL, POLICY)
    expect(pastThePole.center.lat).toBeLessThan(85.0511287798066)
    expectInsideOneWorld(pastThePole, SMALL)

    const inside = camera(13.4, 52.5, 18, 30)
    expect(constrainCamera(inside, SMALL, POLICY)).toBe(inside)
  })

  it('the zoom floor does not depend on the centre', () => {
    const centres = [[0, 0], [179, 85], [-120, -60], [45, 30]] as const
    for (const bearingDeg of [0, 20, 45, 90]) {
      const zooms = centres.map(([lon, lat]) => constrainCamera(camera(lon, lat, -1, bearingDeg), LANDSCAPE, POLICY).zoom)
      expect(new Set(zooms).size).toBe(1)
      expect(zooms[0]).toBe(zoomFloorForArc(LANDSCAPE, POLICY, bearingDeg, bearingDeg))
    }
    const overArc = centres.map(([lon, lat]) => constrainCamera(camera(lon, lat, -1, 10), LANDSCAPE, POLICY, { fromDeg: 10, toDeg: 80 }).zoom)
    expect(new Set(overArc).size).toBe(1)
    // The arc passes both of the box's peaks, so its floor is the screen diagonal's.
    expect(overArc[0]).toBeCloseTo(Math.log2(Math.hypot(1000, 800) / MAPLIBRE_WORLD_TILE_SIZE), 12)
  })

  it('zoomFloorForArc at bearing 0 equals singleWorldEffectiveMinimumZoom', () => {
    const screens: ViewScreen[] = [
      SMALL, LANDSCAPE, PORTRAIT,
      { width: 512, height: 512, devicePixelRatio: 1 },
      { width: 513, height: 1, devicePixelRatio: 1 },
      { width: 1920, height: 1080, devicePixelRatio: 1.5 },
      { width: 0, height: 0, devicePixelRatio: 1 },
    ]
    for (const screen of screens) {
      const expected = singleWorldEffectiveMinimumZoom(screen.width, screen.height, POLICY.minZoom)
      expect(zoomFloorForArc(screen, POLICY, 0, 0)).toBe(expected)
      expect(zoomFloorForArc(screen, POLICY, 360, -360)).toBe(expected)
    }
  })

  it('zoomFloorForArc takes the largest box over the arc, along the shortest way round', () => {
    const at = (deg: number) => zoomFloorForArc(LANDSCAPE, POLICY, deg, deg)
    expect(zoomFloorForArc(LANDSCAPE, POLICY, 0, 30)).toBe(Math.max(at(0), at(30)))
    // No peak lies between 350 and 10, and north is the box's narrowest there.
    expect(zoomFloorForArc(LANDSCAPE, POLICY, 350, 10)).toBe(Math.max(at(350), at(10)))
    // 20 → 350 runs back through north, not forwards through the box's peaks near 45.
    expect(zoomFloorForArc(LANDSCAPE, POLICY, 20, 350)).toBe(Math.max(at(20), at(350)))
    expect(zoomFloorForArc(LANDSCAPE, POLICY, 20, 350)).toBeLessThan(at(45))
    expect(zoomFloorForArc(LANDSCAPE, POLICY, 0, 90)).toBeCloseTo(Math.log2(Math.hypot(1000, 800) / MAPLIBRE_WORLD_TILE_SIZE), 12)
  })

  it('bearing helpers follow the spec examples', () => {
    expect(normaliseBearing(-1e-14)).toBe(0)
    expect(normaliseBearing(360)).toBe(0)
    expect(normaliseBearing(-0)).toBe(0)
    expect(normaliseBearing(-90)).toBe(270)
    expect(normaliseBearing(725)).toBe(5)
    expect(angularDistanceToNorth(359.99)).toBeLessThan(0.05)
    expect(angularDistanceToNorth(200)).toBe(160)
    expect(snapBearing(5)).toBe(0)
    expect(snapBearing(353)).toBe(0)
    expect(snapBearing(8)).toBe(8)
    expect(roundToStep(22, 15)).toBe(15)
    expect(roundToStep(353, 15)).toBe(0)
    expect([0, 22, 352].map((deg) => nextStep(deg, 1, 15))).toEqual([15, 30, 0])
    expect([0, 22, 352].map((deg) => nextStep(deg, -1, 15))).toEqual([345, 15, 345])
    expect(nextStep(15.0000000001, 1, 15)).toBe(30)
    expect(nextStep(29.9999999999, -1, 15)).toBe(15)
    expect(shortestArc(350, 10)).toBe(20)
    expect(shortestArc(10, 350)).toBe(-20)
    expect(shortestArc(0, 180)).toBe(180)
    expect(shortestArc(180, 0)).toBe(180)
  })
})
