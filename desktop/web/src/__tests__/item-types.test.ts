import { beforeEach, describe, expect, it } from 'vitest'
import type { RasterQuantity } from '../generated/contracts'
import {
  IMPORTABLE_QUANTITIES,
  RASTER_QUANTITIES,
  SLOPE_PERCENT_MAX,
  itemTypeLabel,
  itemTypeStyle,
  unitSuffix,
} from '../app/lidar/item-types'
import { formatLegendValue } from '../app/lidar/display-legend'
import { locale } from '../app/settings/state'

const raster = (quantity: RasterQuantity) => ({ kind: 'Raster' as const, quantity })

describe('library item types', () => {
  beforeEach(() => {
    locale.value = 'en'
  })

  it('colours elevation with terrain over the display range', () => {
    for (const quantity of ['GroundElevation', 'SurfaceElevation'] as const) {
      expect(itemTypeStyle(raster(quantity), { units: 'm', displayRange: [104, 132] }))
        .toEqual({ colormap: 'terrain', reversed: false, rescale: [104, 132], units: 'm' })
    }
  })

  it('colours heights and other values with viridis, widening a flat range', () => {
    expect(itemTypeStyle(raster('AboveGroundHeight'), { units: 'm', displayRange: [3, 3] }))
      .toEqual({ colormap: 'viridis', reversed: false, rescale: [3, 4], units: 'm' })
    expect(itemTypeStyle(raster('OtherContinuous'), { units: 'kg', displayRange: null }))
      .toEqual({ colormap: 'viridis', reversed: false, rescale: [0, 1], units: 'kg' })
  })

  it('colours slope over a fixed 60° domain in its own unit, never percent as degrees', () => {
    expect(itemTypeStyle(raster('Slope'), { units: '°', displayRange: [0, 12] }))
      .toEqual({ colormap: 'magma', reversed: true, rescale: [0, 60], units: '°' })
    expect(itemTypeStyle(raster('Slope'), { units: '%', displayRange: [0, 12] }))
      .toEqual({ colormap: 'magma', reversed: true, rescale: [0, SLOPE_PERCENT_MAX], units: '%' })
    expect(SLOPE_PERCENT_MAX).toBe(173.2)
  })

  it('imports only measured quantities; slope is derived only', () => {
    expect(IMPORTABLE_QUANTITIES).toEqual(['GroundElevation', 'SurfaceElevation', 'AboveGroundHeight', 'OtherContinuous'])
    expect(RASTER_QUANTITIES.Slope.importable).toBe(false)
  })

  it('labels every quantity through its own key', () => {
    expect(itemTypeLabel(raster('Slope'))).toBe('Slope')
    expect(itemTypeLabel(raster('AboveGroundHeight'))).toBe('Height above ground')
    locale.value = 'fr'
    expect(itemTypeLabel(raster('GroundElevation'))).toBe('Altitude du sol')
  })

  it('writes legend units after the value: degrees and percent attached, others spaced', () => {
    expect(unitSuffix('°')).toBe('°')
    expect(unitSuffix('m')).toBe(' m')
    expect(unitSuffix('unknown')).toBe('')
    expect(formatLegendValue(60, '°')).toBe('60.0°')
    expect(formatLegendValue(173.2, '%')).toBe('173%')
    expect(formatLegendValue(104.25, 'm')).toBe('104 m')
    expect(formatLegendValue(1.5, '')).toBe('1.50')
  })
})
