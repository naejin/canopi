/**
 * Tests for projection.ts — canonical canvas↔map projection utilities.
 *
 * Converts between canvas world coordinates (meters from origin) and the
 * Mercator-backed geographic coordinates consumed by MapLibre.
 */
import { describe, it, expect } from 'vitest'
import {
  worldToGeo,
  geoToWorld,
  stageScaleToMapZoom,
  stageViewportCenter,
  viewportCenterGeo,
  viewportCornerGeoPoints,
} from '../canvas/projection'

// ---------------------------------------------------------------------------
// worldToGeo
// ---------------------------------------------------------------------------
describe('worldToGeo', () => {
  it('returns origin when displacement is zero', () => {
    const result = worldToGeo(0, 0, 45.52, -122.68)
    expect(result.lng).toBeCloseTo(-122.68, 10)
    expect(result.lat).toBeCloseTo(45.52, 10)
  })

  it('1000m east at equator gives ~0.00898 degrees longitude', () => {
    const result = worldToGeo(1000, 0, 0, 0)
    expect(result.lng).toBeCloseTo(0.008993, 5)
    expect(result.lat).toBeCloseTo(0, 5)
  })

  it('negative y (north in canvas space) increases latitude', () => {
    const result = worldToGeo(0, -500, 45.52, -122.68)
    expect(result.lat).toBeGreaterThan(45.52)
    expect(result.lng).toBeCloseTo(-122.68, 5)
  })

  it('positive y (south in Konva) decreases latitude', () => {
    const result = worldToGeo(0, 1000, 45.52, -122.68)
    expect(result.lat).toBeLessThan(45.52)
  })

  it('rotates canvas axes when north bearing is non-zero', () => {
    const northUp = worldToGeo(100, 0, 45.52, -122.68, 0)
    const rotated = worldToGeo(100, 0, 45.52, -122.68, 90)
    expect(rotated.lng).not.toBeCloseTo(northUp.lng, 8)
    expect(rotated.lat).not.toBeCloseTo(northUp.lat, 8)
  })
})

// ---------------------------------------------------------------------------
// geoToWorld
// ---------------------------------------------------------------------------
describe('geoToWorld', () => {
  it('returns 0,0 when geo coords equal origin', () => {
    const result = geoToWorld(-122.68, 45.52, 45.52, -122.68)
    expect(result.x).toBeCloseTo(0, 10)
    expect(result.y).toBeCloseTo(0, 10)
  })

  it('east of origin gives positive x', () => {
    const result = geoToWorld(1, 0, 0, 0)
    expect(result.x).toBeGreaterThan(100000)
    expect(result.y).toBeCloseTo(0, 2)
  })

  it('north of origin gives negative y (Konva y-down)', () => {
    // 1 degree north of origin
    const result = geoToWorld(0, 1, 0, 0)
    expect(result.x).toBeCloseTo(0, 2)
    expect(result.y).toBeCloseTo(-111200.726, 3)
  })

  it('south of origin gives positive y', () => {
    const result = geoToWorld(0, -1, 0, 0)
    expect(result.x).toBeCloseTo(0, 2)
    expect(result.y).toBeCloseTo(111200.726, 3)
  })

  it('at 60N, 1 degree longitude is ~55660m', () => {
    const result = geoToWorld(1, 60, 60, 0)
    expect(result.x).toBeGreaterThan(55000)
    expect(result.x).toBeLessThan(56000)
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

  it('round-trips with non-zero north bearing', () => {
    const geo = worldToGeo(300, -150, 45.52, -122.68, 90)
    const world = geoToWorld(geo.lng, geo.lat, 45.52, -122.68, 90)
    expect(world.x).toBeCloseTo(300, 2)
    expect(world.y).toBeCloseTo(-150, 2)
  })
})

// ---------------------------------------------------------------------------
// stageScaleToMapZoom
// ---------------------------------------------------------------------------
describe('stageScaleToMapZoom', () => {
  it('at equator, stageScale=1 gives zoom ~16.25 in MapLibre 512px world units', () => {
    const zoom = stageScaleToMapZoom(1, 0)
    expect(zoom).toBeCloseTo(16.255, 1)
  })

  it('higher stageScale gives higher zoom (monotonic)', () => {
    const zoom1 = stageScaleToMapZoom(1, 45)
    const zoom2 = stageScaleToMapZoom(2, 45)
    const zoom4 = stageScaleToMapZoom(4, 45)
    expect(zoom2).toBeGreaterThan(zoom1)
    expect(zoom4).toBeGreaterThan(zoom2)
    expect(zoom2 - zoom1).toBeCloseTo(1, 5)
    expect(zoom4 - zoom2).toBeCloseTo(1, 5)
  })

  it('at 60N, stageScale=1 gives lower zoom than equator', () => {
    const zoomEquator = stageScaleToMapZoom(1, 0)
    const zoom60 = stageScaleToMapZoom(1, 60)
    expect(zoom60).toBeLessThan(zoomEquator)
    expect(zoomEquator - zoom60).toBeCloseTo(1, 5)
  })

  it('at equator, stageScale=0.1 gives zoom ~12.93', () => {
    const zoom = stageScaleToMapZoom(0.1, 0)
    expect(zoom).toBeCloseTo(12.934, 1)
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

describe('viewportCenterGeo', () => {
  it('matches stageViewportCenter for zero bearing', () => {
    const result = viewportCenterGeo(
      { x: -200, y: -100, scale: 2 },
      { width: 1000, height: 800 },
      45.52,
      -122.68,
      0,
    )
    const expected = worldToGeo(350, 250, 45.52, -122.68)
    expect(result.lng).toBeCloseTo(expected.lng, 8)
    expect(result.lat).toBeCloseTo(expected.lat, 8)
  })

  it('accounts for north bearing when converting viewport center', () => {
    const rotated = viewportCenterGeo(
      { x: -200, y: -100, scale: 2 },
      { width: 1000, height: 800 },
      45.52,
      -122.68,
      90,
    )
    const northUp = viewportCenterGeo(
      { x: -200, y: -100, scale: 2 },
      { width: 1000, height: 800 },
      45.52,
      -122.68,
      0,
    )
    expect(rotated.lng).not.toBeCloseTo(northUp.lng, 8)
    expect(rotated.lat).not.toBeCloseTo(northUp.lat, 8)
  })
})

describe('viewportCornerGeoPoints', () => {
  it('returns four projected corner points for the current viewport', () => {
    const corners = viewportCornerGeoPoints(
      { x: -200, y: -100, scale: 2 },
      { width: 1000, height: 800 },
      45.52,
      -122.68,
      0,
    )

    expect(corners).toHaveLength(4)
    expect(corners[0]!.lng).toBeLessThan(corners[1]!.lng)
    expect(corners[0]!.lat).toBeGreaterThan(corners[2]!.lat)
  })
})
