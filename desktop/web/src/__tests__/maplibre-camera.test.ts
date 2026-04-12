import { describe, expect, it } from 'vitest'
import { computeMapLibreCamera } from '../canvas/maplibre-camera'
import { stageScaleToMapZoom, worldToGeo } from '../canvas/projection'

describe('computeMapLibreCamera', () => {
  it('returns null when location is missing', () => {
    const result = computeMapLibreCamera(
      { x: 0, y: 0, scale: 1 },
      { width: 1000, height: 800 },
      null,
      12,
    )

    expect(result).toBeNull()
  })

  it('returns null when screen size is invalid', () => {
    const result = computeMapLibreCamera(
      { x: 0, y: 0, scale: 1 },
      { width: 0, height: 800 },
      { lat: 45.52, lon: -122.68 },
      12,
    )

    expect(result).toBeNull()
  })

  it('projects viewport center into a MapLibre camera', () => {
    const result = computeMapLibreCamera(
      { x: -200, y: -100, scale: 2 },
      { width: 1000, height: 800 },
      { lat: 45.52, lon: -122.68 },
      14,
    )

    expect(result).not.toBeNull()
    const expectedCenter = worldToGeo(350, 250, 45.52, -122.68)
    expect(result!.center[0]).toBeCloseTo(expectedCenter.lng, 8)
    expect(result!.center[1]).toBeCloseTo(expectedCenter.lat, 8)
    expect(result!.zoom).toBeCloseTo(stageScaleToMapZoom(2, 45.52), 8)
    expect(result!.bearing).toBe(14)
  })

  it('clamps extreme zoom values into the MapLibre range', () => {
    const result = computeMapLibreCamera(
      { x: 0, y: 0, scale: 5000 },
      { width: 1000, height: 800 },
      { lat: 0, lon: 0 },
      null,
    )

    expect(result).not.toBeNull()
    expect(result!.zoom).toBeLessThanOrEqual(24)
    expect(result!.bearing).toBe(0)
  })
})
