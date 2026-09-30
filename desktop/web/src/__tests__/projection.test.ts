/**
 * Tests for projection.ts — canonical canvas↔map projection utilities.
 *
 * Converts between canvas world coordinates (meters from origin) and the
 * Mercator-backed geographic coordinates consumed by MapLibre.
 */
import { describe, it, expect } from 'vitest'
import {
  worldToGeo,
  stageScaleToMapZoom,
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

  it('positive y (south in canvas coordinates) decreases latitude', () => {
    const result = worldToGeo(0, 1000, 45.52, -122.68)
    expect(result.lat).toBeLessThan(45.52)
  })

  it('keeps the canvas north-up: x displacement changes only longitude', () => {
    const result = worldToGeo(100, 0, 45.52, -122.68)
    expect(result.lng).toBeGreaterThan(-122.68)
    expect(result.lat).toBeCloseTo(45.52, 10)
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
