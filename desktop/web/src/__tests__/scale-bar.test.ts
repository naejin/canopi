import { describe, expect, it } from 'vitest'
import { getScaleBarDisplay } from '../canvas/scale-bar'
import {
  COMMON_MAP_SCALES,
  formatMapScale,
  mapScaleDenominator,
  roundScaleDenominator,
  zoomFactorForScale,
} from '../canvas/map-scale'
import type { CameraViewportSnapshot } from '../canvas/runtime/camera'

function frame(scale: number, groundMetersPerCssPixel: number | null = null): CameraViewportSnapshot {
  return {
    viewport: { x: 0, y: 0, scale },
    screenSize: { width: 800, height: 600 },
    devicePixelRatio: 1,
    referenceScale: 20,
    scaleBounds: { minimum: 0.00001, maximum: 2000 },
    overviewScaleThreshold: 0.1,
    mode: scale < 0.1 ? 'overview' : 'site',
    groundMetersPerCssPixel,
    revision: 1,
  }
}

describe('scale bar metrics', () => {
  it('picks a round 1/2/5 ground distance whose bar fits the zoom group', () => {
    expect(getScaleBarDisplay(20)).toEqual({ barScreenPx: 100, meters: 5 })
    expect(getScaleBarDisplay(7.25)).toEqual({ barScreenPx: 72.5, meters: 10 })
    const world = getScaleBarDisplay(0.00001)
    expect(world.meters).toBe(10_000_000)
    expect(world.barScreenPx).toBeCloseTo(100)
  })
})

describe('map scale ratio', () => {
  it('reads 1:190 at 20 CSS px per metre, the Design default', () => {
    expect(mapScaleDenominator(frame(20))).toBeCloseTo(189, 0)
    expect(formatMapScale(mapScaleDenominator(frame(20)), 'en')).toBe('1:190')
  })

  it('uses the map ground resolution when a map is attached', () => {
    expect(formatMapScale(mapScaleDenominator(frame(0.001, 13.2)), 'en')).toBe('1:50,000')
  })

  it('rounds to two significant figures and formats digits through Intl', () => {
    expect(roundScaleDenominator(1_493)).toBe(1_500)
    expect(roundScaleDenominator(49_812_345)).toBe(50_000_000)
    expect(formatMapScale(1_493, 'en')).toBe('1:1,500')
    expect(formatMapScale(1_493, 'de')).toBe('1:1.500')
    expect(formatMapScale(49_812_345, 'fr')).toBe(`1:${new Intl.NumberFormat('fr').format(50_000_000)}`)
  })

  it('zooms by the ratio between the current and chosen scale', () => {
    expect(zoomFactorForScale(1_000, 500)).toBe(2)
    expect(zoomFactorForScale(190, 1_000)).toBeCloseTo(0.19)
    expect(COMMON_MAP_SCALES[0]).toBe(100)
  })
})
