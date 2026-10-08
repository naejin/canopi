import { beforeEach, describe, expect, it } from 'vitest'
import type { LidarRamp, RasterQuantity } from '../generated/contracts'
import {
  IMPORTABLE_QUANTITIES,
  RASTER_QUANTITIES,
  itemTypeLabel,
  itemTypeStyle,
  kindDisplayDefaults,
  kindRamps,
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

  /** An entry at its kind's default display, as a library preview draws it. */
  const defaults = { ramp: null, reversed: false, range: null } as const

  it('offers three ramps per kind, the default first, with Gray last for comparing under hillshade', () => {
    expect(kindRamps(raster('GroundElevation'))).toEqual(['Terrain', 'Earth', 'Gray'])
    expect(kindRamps(raster('SurfaceElevation'))).toEqual(['Terrain', 'Earth', 'Gray'])
    expect(kindRamps(raster('AboveGroundHeight'))).toEqual(['Greens', 'Magma', 'Gray'])
    expect(kindRamps(raster('Slope'))).toEqual(['YellowRed', 'Magma', 'Gray'])
    expect(kindRamps(raster('OtherContinuous'))).toEqual(['Magma', 'YellowRed', 'Gray'])
  })

  it('draws each ramp with one renderer colormap', () => {
    const colormap = (ramp: LidarRamp) => itemTypeStyle(raster('OtherContinuous'), { units: '', displayRange: null, ramp, reversed: false, range: null }).colormap
    const ramps: LidarRamp[] = ['Terrain', 'Earth', 'Greens', 'YellowRed', 'Magma', 'Gray']
    expect(ramps.map(colormap)).toEqual(['schwarzwald', 'turbid', 'greens', 'ylorrd', 'magma', 'gray'])
  })

  it('colours elevation with Terrain over the data range by default, keeping blue for water', () => {
    for (const quantity of ['GroundElevation', 'SurfaceElevation'] as const) {
      expect(itemTypeStyle(raster(quantity), { units: 'm', displayRange: [104, 132], ...defaults }))
        .toEqual({ ramp: 'Terrain', colormap: 'schwarzwald', reversed: false, rescale: [104, 132], units: 'm' })
    }
  })

  it('colours heights with Greens and other values with Magma, widening a flat range', () => {
    expect(itemTypeStyle(raster('AboveGroundHeight'), { units: 'm', displayRange: [3, 3], ...defaults }))
      .toEqual({ ramp: 'Greens', colormap: 'greens', reversed: false, rescale: [3, 4], units: 'm' })
    expect(itemTypeStyle(raster('OtherContinuous'), { units: 'kg', displayRange: null, ...defaults }))
      .toEqual({ ramp: 'Magma', colormap: 'magma', reversed: false, rescale: [0, 1], units: 'kg' })
  })

  it('colours slope with Yellow–red over a fixed 30° domain in its own unit, never percent as degrees', () => {
    expect(itemTypeStyle(raster('Slope'), { units: '°', displayRange: [0, 12], ...defaults }))
      .toEqual({ ramp: 'YellowRed', colormap: 'ylorrd', reversed: false, rescale: [0, 30], units: '°' })
    expect(itemTypeStyle(raster('Slope'), { units: '%', displayRange: [0, 12], ...defaults }))
      .toEqual({ ramp: 'YellowRed', colormap: 'ylorrd', reversed: false, rescale: [0, 57.7], units: '%' })
  })

  it('draws the entry\'s own ramp, Reverse and range', () => {
    const ground = raster('GroundElevation')
    expect(itemTypeStyle(ground, { units: 'm', displayRange: [104, 132], ramp: 'Gray', reversed: true, range: { mode: 'Custom', min: 110, max: 120 } }))
      .toEqual({ ramp: 'Gray', colormap: 'gray', reversed: true, rescale: [110, 120], units: 'm' })
    expect(itemTypeStyle(raster('Slope'), { units: '°', displayRange: [0, 12], ramp: null, reversed: false, range: { mode: 'Data' } }).rescale)
      .toEqual([0, 12])
  })

  it('cuts outliers to the 2–98 % range once it is known, and draws the data range until then', () => {
    const ground = raster('GroundElevation')
    const cut = { units: 'm', displayRange: [104, 132] as [number, number], ramp: null, reversed: false, range: { mode: 'CutOutliers' as const } }
    expect(itemTypeStyle(ground, { ...cut, cutRange: [106.5, 129.25] }).rescale).toEqual([106.5, 129.25])
    expect(itemTypeStyle(ground, cut).rescale).toEqual([104, 132])
  })

  it('gives each kind\'s default display: its first ramp, and the data range or slope\'s 0–30°', () => {
    expect(kindDisplayDefaults(raster('OtherContinuous'), 'kg')).toEqual({ ramp: 'Magma', range: { mode: 'Data' } })
    expect(kindDisplayDefaults(raster('Slope'), '%')).toEqual({ ramp: 'YellowRed', range: { mode: 'Custom', min: 0, max: 57.7 } })
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
