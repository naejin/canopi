import { describe, expect, it } from 'vitest'
import {
  COMMON_MAP_SCALES,
  formatMapScale,
  getScaleBarDisplay,
  mapScaleDenominator,
  roundScaleDenominator,
  zoomFactorForScale,
} from '../canvas/map-scale'

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
    expect(mapScaleDenominator(1 / 20)).toBeCloseTo(189, 0)
    expect(formatMapScale(mapScaleDenominator(1 / 20), 'en')).toBe('1:190')
  })

  it('uses the map ground resolution when a map is attached', () => {
    expect(formatMapScale(mapScaleDenominator(13.2), 'en')).toBe('1:50,000')
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
