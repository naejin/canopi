import { beforeEach, describe, expect, it } from 'vitest'
import type { RasterQuantity } from '../generated/contracts'
import {
  IMPORTABLE_QUANTITIES,
  RASTER_QUANTITIES,
  itemTypeLabel,
  itemTypeStyle,
  profileRole,
  unitSuffix,
} from '../app/lidar/item-types'
import { formatLegendValue, formatRasterMetres, formatRasterRange, formatRasterSample } from '../app/lidar/display-legend'
import { locale } from '../app/settings/state'

const raster = (quantity: RasterQuantity) => ({ kind: 'Raster' as const, quantity })

describe('library item types', () => {
  beforeEach(() => {
    locale.value = 'en'
  })

  it('profiles elevations on one axis and heights on another, and nothing else', () => {
    expect(profileRole(raster('GroundElevation'))).toBe('elevation')
    expect(profileRole(raster('SurfaceElevation'))).toBe('elevation')
    expect(profileRole(raster('AboveGroundHeight'))).toBe('height')
    expect(profileRole(raster('Slope'))).toBeNull()
    expect(profileRole(raster('OtherContinuous'))).toBeNull()
  })

  it('colours elevation with schwarzwald over the display range, keeping blue for water', () => {
    for (const quantity of ['GroundElevation', 'SurfaceElevation'] as const) {
      expect(itemTypeStyle(raster(quantity), { units: 'm', displayRange: [104, 132] }))
        .toEqual({ colormap: 'schwarzwald', reversed: false, rescale: [104, 132], units: 'm' })
    }
  })

  it('colours heights with greens and other values with viridis, widening a flat range', () => {
    expect(itemTypeStyle(raster('AboveGroundHeight'), { units: 'm', displayRange: [3, 3] }))
      .toEqual({ colormap: 'greens', reversed: false, rescale: [3, 4], units: 'm' })
    expect(itemTypeStyle(raster('OtherContinuous'), { units: 'kg', displayRange: null }))
      .toEqual({ colormap: 'viridis', reversed: false, rescale: [0, 1], units: 'kg' })
  })

  it('colours slope with ylorrd over a fixed 30° domain in its own unit, never percent as degrees', () => {
    expect(itemTypeStyle(raster('Slope'), { units: '°', displayRange: [0, 12] }))
      .toEqual({ colormap: 'ylorrd', reversed: false, rescale: [0, 30], units: '°' })
    expect(itemTypeStyle(raster('Slope'), { units: '%', displayRange: [0, 12] }))
      .toEqual({ colormap: 'ylorrd', reversed: false, rescale: [0, 57.7], units: '%' })
  })

  it('imports only measured quantities; slope is derived only', () => {
    expect(IMPORTABLE_QUANTITIES).toEqual(['GroundElevation', 'SurfaceElevation', 'AboveGroundHeight', 'OtherContinuous'])
    expect(RASTER_QUANTITIES.Slope.importable).toBe(false)
  })

  it('labels every quantity through its own key', () => {
    expect(itemTypeLabel(raster('Slope'))).toBe('Slope')
    expect(itemTypeLabel(raster('AboveGroundHeight'))).toBe('Height above ground (CHM)')
    locale.value = 'fr'
    expect(itemTypeLabel(raster('GroundElevation'))).toBe('Altitude du sol (MNT)')
  })

  it('writes legend units after the value: degrees and percent attached, others spaced', () => {
    expect(unitSuffix('°')).toBe('°')
    expect(unitSuffix('m')).toBe(' m')
    expect(unitSuffix('unknown')).toBe('')
    expect(formatLegendValue(60, '°', 'en')).toBe('60.0°')
    expect(formatLegendValue(173.2, '%', 'en')).toBe('173%')
    expect(formatLegendValue(104.25, 'm', 'en')).toBe('104 m')
    expect(formatLegendValue(1.5, '', 'en')).toBe('1.50')
  })

  it('formats raster numbers with the interface locale', () => {
    expect(formatLegendValue(1.5, 'm', 'fr')).toBe('1,50 m')
    expect(formatLegendValue(-12.25, '°', 'de')).toBe('-12,3°')
    expect(formatRasterMetres(0.5, 'en')).toBe('0.50 m')
    expect(formatRasterMetres(0.5, 'fr')).toBe('0,50 m')
    expect(formatRasterMetres(2.25, 'de')).toBe('2,3 m')
    expect(formatRasterMetres(12, 'fr')).toBe('12 m')
    expect(formatRasterRange([1, 2.25], 'm', 'fr')).toBe('1,0 – 2,3 m')
    expect(formatRasterRange([10, 30], '%', 'en')).toBe('10.0 – 30.0%')
    expect(formatRasterSample(1234.5, 'fr')).toBe('1\u202f234,50')
    expect(formatRasterSample(1.23456, 'de')).toBe('1,235')
    expect(formatRasterSample(0.5, 'en')).toBe('0.5000')
  })
})
