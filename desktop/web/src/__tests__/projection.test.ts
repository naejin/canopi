/**
 * Tests for projection.ts — Local Tangent Plane projection utilities.
 *
 * Converts between Konva world coordinates (meters from origin) and
 * geographic coordinates (lng/lat). Valid for areas up to ~50km.
 */
import { describe, it, expect } from 'vitest'
import {
  worldToGeo,
  geoToWorld,
  stageScaleToMapZoom,
  stageViewportCenter,
} from '../canvas/projection'

// ---------------------------------------------------------------------------
// worldToGeo
// ---------------------------------------------------------------------------
describe('worldToGeo', () => {
  it('returns origin when displacement is zero', () => {
    const result = worldToGeo(0, 0, 45.52, -122.68)
    expect(result.lng).toBe(-122.68)
    expect(result.lat).toBe(45.52)
  })

  it('1000m east at equator gives ~0.00898 degrees longitude', () => {
    const result = worldToGeo(1000, 0, 0, 0)
    // At equator, metersPerDegLon = 111320 * cos(0) = 111320
    // 1000 / 111320 ≈ 0.008983
    expect(result.lng).toBeCloseTo(0.008983, 5)
    expect(result.lat).toBeCloseTo(0, 5)
  })

  it('1000m east at 60N gives ~0.01797 degrees longitude (cos(60) = 0.5)', () => {
    const result = worldToGeo(1000, 0, 60, 0)
    // metersPerDegLon = 111320 * cos(60°) = 111320 * 0.5 = 55660
    // 1000 / 55660 ≈ 0.017966
    expect(result.lng).toBeCloseTo(0.017966, 5)
    expect(result.lat).toBeCloseTo(60, 5)
  })

  it('500m north at Portland (y=-500) increases latitude by ~0.00449', () => {
    // Konva y-down = south, so y=-500 = 500m north
    const result = worldToGeo(0, -500, 45.52, -122.68)
    // 500 / 111320 ≈ 0.004492
    expect(result.lat).toBeCloseTo(45.52 + 0.004492, 5)
    expect(result.lng).toBeCloseTo(-122.68, 5)
  })

  it('positive y (south in Konva) decreases latitude', () => {
    const result = worldToGeo(0, 1000, 45.52, -122.68)
    expect(result.lat).toBeLessThan(45.52)
    expect(result.lat).toBeCloseTo(45.52 - 1000 / 111320, 5)
  })

  it('handles negative origin longitude', () => {
    const result = worldToGeo(500, 0, 40, -100)
    const metersPerDegLon = 111320 * Math.cos((40 * Math.PI) / 180)
    expect(result.lng).toBeCloseTo(-100 + 500 / metersPerDegLon, 5)
    expect(result.lat).toBeCloseTo(40, 5)
  })
})

// ---------------------------------------------------------------------------
// geoToWorld
// ---------------------------------------------------------------------------
describe('geoToWorld', () => {
  it('returns 0,0 when geo coords equal origin', () => {
    const result = geoToWorld(-122.68, 45.52, 45.52, -122.68)
    expect(result.x).toBeCloseTo(0, 10)
    expect(result.y).toBeCloseTo(0, 10) // -(0) * 111320 = -0 in JS
  })

  it('east of origin gives positive x', () => {
    const result = geoToWorld(1, 0, 0, 0)
    // At equator: metersPerDegLon = 111320
    expect(result.x).toBeCloseTo(111320, 0)
    expect(result.y).toBeCloseTo(0, 2)
  })

  it('north of origin gives negative y (Konva y-down)', () => {
    // 1 degree north of origin
    const result = geoToWorld(0, 1, 0, 0)
    expect(result.x).toBeCloseTo(0, 2)
    expect(result.y).toBeCloseTo(-111320, 0)
  })

  it('south of origin gives positive y', () => {
    const result = geoToWorld(0, -1, 0, 0)
    expect(result.x).toBeCloseTo(0, 2)
    expect(result.y).toBeCloseTo(111320, 0)
  })

  it('at 60N, 1 degree longitude is ~55660m', () => {
    const result = geoToWorld(1, 60, 60, 0)
    // metersPerDegLon = 111320 * cos(60°) = 55660
    expect(result.x).toBeCloseTo(55660, 0)
    expect(result.y).toBeCloseTo(0, 2)
  })
})

// ---------------------------------------------------------------------------
// worldToGeo + geoToWorld round-trip
// ---------------------------------------------------------------------------
describe('worldToGeo / geoToWorld round-trip', () => {
  const cases: Array<{ name: string; x: number; y: number; originLat: number; originLon: number }> = [
    { name: 'equator origin, 1km east', x: 1000, y: 0, originLat: 0, originLon: 0 },
    { name: 'equator origin, 1km north', x: 0, y: -1000, originLat: 0, originLon: 0 },
    { name: 'Portland, diagonal displacement', x: 300, y: -700, originLat: 45.52, originLon: -122.68 },
    { name: '60N, south-west displacement', x: -2000, y: 1500, originLat: 60, originLon: 10 },
    { name: 'southern hemisphere', x: 800, y: 200, originLat: -33.87, originLon: 151.21 },
    { name: 'zero displacement', x: 0, y: 0, originLat: 51.5, originLon: -0.12 },
  ]

  for (const c of cases) {
    it(`round-trips within 0.01m: ${c.name}`, () => {
      const geo = worldToGeo(c.x, c.y, c.originLat, c.originLon)
      const world = geoToWorld(geo.lng, geo.lat, c.originLat, c.originLon)
      expect(world.x).toBeCloseTo(c.x, 2)
      expect(world.y).toBeCloseTo(c.y, 2)
    })
  }

  it('geoToWorld then worldToGeo round-trips within 1e-8 degrees', () => {
    const lng = -122.7
    const lat = 45.55
    const originLat = 45.52
    const originLon = -122.68
    const world = geoToWorld(lng, lat, originLat, originLon)
    const geo = worldToGeo(world.x, world.y, originLat, originLon)
    expect(geo.lng).toBeCloseTo(lng, 8)
    expect(geo.lat).toBeCloseTo(lat, 8)
  })
})

// ---------------------------------------------------------------------------
// stageScaleToMapZoom
// ---------------------------------------------------------------------------
describe('stageScaleToMapZoom', () => {
  it('at equator, stageScale=1 gives zoom ~17.25', () => {
    const zoom = stageScaleToMapZoom(1, 0)
    // log2(1 * 156543.03392 * cos(0)) = log2(156543.03392) ≈ 17.255
    expect(zoom).toBeCloseTo(17.255, 1)
  })

  it('higher stageScale gives higher zoom (monotonic)', () => {
    const zoom1 = stageScaleToMapZoom(1, 45)
    const zoom2 = stageScaleToMapZoom(2, 45)
    const zoom4 = stageScaleToMapZoom(4, 45)
    expect(zoom2).toBeGreaterThan(zoom1)
    expect(zoom4).toBeGreaterThan(zoom2)
    // Doubling stageScale adds exactly 1 to zoom
    expect(zoom2 - zoom1).toBeCloseTo(1, 5)
    expect(zoom4 - zoom2).toBeCloseTo(1, 5)
  })

  it('at 60N, stageScale=1 gives lower zoom than equator', () => {
    const zoomEquator = stageScaleToMapZoom(1, 0)
    const zoom60 = stageScaleToMapZoom(1, 60)
    expect(zoom60).toBeLessThan(zoomEquator)
    // cos(60°) = 0.5, so difference should be exactly 1 (log2(0.5) = -1)
    expect(zoomEquator - zoom60).toBeCloseTo(1, 5)
  })

  it('at equator, stageScale=0.1 gives zoom ~13.93', () => {
    const zoom = stageScaleToMapZoom(0.1, 0)
    // log2(0.1 * 156543.03392) = log2(15654.303392) ≈ 13.934
    expect(zoom).toBeCloseTo(13.934, 1)
  })
})

// ---------------------------------------------------------------------------
// stageViewportCenter
// ---------------------------------------------------------------------------
describe('stageViewportCenter', () => {
  function mockStage(w: number, h: number, posX: number, posY: number, scale: number) {
    return {
      width: () => w,
      height: () => h,
      position: () => ({ x: posX, y: posY }),
      scaleX: () => scale,
    }
  }

  it('un-panned stage at scale=1 gives center at half-width/height in world coords', () => {
    // stage pos (0,0), scale 1, 1000x800
    // centerWorldX = (-0 + 500) / 1 = 500
    // centerWorldY = (-0 + 400) / 1 = 400
    const stage = mockStage(1000, 800, 0, 0, 1)
    const result = stageViewportCenter(stage, 0, 0)

    // Verify via manual worldToGeo(500, 400, 0, 0)
    const expected = worldToGeo(500, 400, 0, 0)
    expect(result.lng).toBeCloseTo(expected.lng, 8)
    expect(result.lat).toBeCloseTo(expected.lat, 8)
  })

  it('panned stage shifts the center', () => {
    // stage pos (-200, -100), scale 1, 1000x800
    // centerWorldX = (200 + 500) / 1 = 700
    // centerWorldY = (100 + 400) / 1 = 500
    const stage = mockStage(1000, 800, -200, -100, 1)
    const result = stageViewportCenter(stage, 0, 0)

    const expected = worldToGeo(700, 500, 0, 0)
    expect(result.lng).toBeCloseTo(expected.lng, 8)
    expect(result.lat).toBeCloseTo(expected.lat, 8)
  })

  it('scale factor divides screen pixels to world meters', () => {
    // stage pos (0,0), scale 2, 1000x800
    // centerWorldX = (-0 + 500) / 2 = 250
    // centerWorldY = (-0 + 400) / 2 = 200
    const stage = mockStage(1000, 800, 0, 0, 2)
    const result = stageViewportCenter(stage, 0, 0)

    const expected = worldToGeo(250, 200, 0, 0)
    expect(result.lng).toBeCloseTo(expected.lng, 8)
    expect(result.lat).toBeCloseTo(expected.lat, 8)
  })

  it('works with non-zero origin', () => {
    const stage = mockStage(1000, 800, 0, 0, 1)
    const result = stageViewportCenter(stage, 45.52, -122.68)

    const expected = worldToGeo(500, 400, 45.52, -122.68)
    expect(result.lng).toBeCloseTo(expected.lng, 8)
    expect(result.lat).toBeCloseTo(expected.lat, 8)
  })

  it('combined pan and zoom with real origin', () => {
    // stage pos (-500, -300), scale 0.5, 1200x900
    // centerWorldX = (500 + 600) / 0.5 = 2200
    // centerWorldY = (300 + 450) / 0.5 = 1500
    const stage = mockStage(1200, 900, -500, -300, 0.5)
    const result = stageViewportCenter(stage, 45.52, -122.68)

    const expected = worldToGeo(2200, 1500, 45.52, -122.68)
    expect(result.lng).toBeCloseTo(expected.lng, 8)
    expect(result.lat).toBeCloseTo(expected.lat, 8)
  })
})
