import type { LibraryItemType, RasterQuantity } from '../../generated/contracts'
import { t } from '../../i18n'

/**
 * The single place that knows library item types.
 *
 * Display style, labels and import eligibility dispatch through these tables;
 * nothing else in the frontend branches on a quantity, so a new item type is
 * one entry here rather than a scatter of special cases.
 */

/** Upstream palette and stretch for one item, always in its stored units. */
export interface LidarDisplayStyle {
  readonly colormap: string
  readonly reversed: boolean
  readonly rescale: readonly [number, number]
  /** Units of `rescale`, for the legend. */
  readonly units: string
}

/** What a style needs to know about one item. */
export interface RasterStyleInput {
  readonly units: string
  readonly displayRange: readonly [number, number] | null
}

interface RasterQuantityType {
  readonly labelKey: string
  /** Whether a source can be imported as this quantity; derived-only otherwise. */
  readonly importable: boolean
  style(item: RasterStyleInput): LidarDisplayStyle
}

const SLOPE_DEGREES_MAX = 60
/** The same 60° expressed in percent, so both units share one colour domain. */
export const SLOPE_PERCENT_MAX = Math.round(Math.tan((SLOPE_DEGREES_MAX * Math.PI) / 180) * 1000) / 10

function overDisplayRange(colormap: string) {
  return (item: RasterStyleInput): LidarDisplayStyle => {
    const [min, max] = item.displayRange ?? [0, 1]
    const rescale: [number, number] = max > min ? [min, max] : [min, min + 1]
    return { colormap, reversed: false, rescale, units: item.units }
  }
}

export const RASTER_QUANTITIES: Readonly<Record<RasterQuantity, RasterQuantityType>> = {
  GroundElevation: {
    labelKey: 'canvas.lidar.library.quantity.GroundElevation',
    importable: true,
    style: overDisplayRange('terrain'),
  },
  SurfaceElevation: {
    labelKey: 'canvas.lidar.library.quantity.SurfaceElevation',
    importable: true,
    style: overDisplayRange('terrain'),
  },
  AboveGroundHeight: {
    labelKey: 'canvas.lidar.library.quantity.AboveGroundHeight',
    importable: true,
    style: overDisplayRange('viridis'),
  },
  OtherContinuous: {
    labelKey: 'canvas.lidar.library.quantity.OtherContinuous',
    importable: true,
    style: overDisplayRange('viridis'),
  },
  Slope: {
    labelKey: 'canvas.lidar.library.quantity.Slope',
    importable: false,
    // A fixed domain in the result's own unit, so a percent result is never
    // coloured as degrees and two slopes compare at a glance.
    style: (item) => ({
      colormap: 'magma',
      reversed: true,
      rescale: [0, item.units === '%' ? SLOPE_PERCENT_MAX : SLOPE_DEGREES_MAX],
      units: item.units,
    }),
  },
}

/** Quantities a user can declare when importing a source, in menu order. */
export const IMPORTABLE_QUANTITIES: readonly RasterQuantity[] = (Object.keys(RASTER_QUANTITIES) as RasterQuantity[])
  .filter((quantity) => RASTER_QUANTITIES[quantity].importable)

export function itemTypeLabel(itemType: LibraryItemType): string {
  return t(RASTER_QUANTITIES[itemType.quantity].labelKey)
}

export function itemTypeStyle(itemType: LibraryItemType, item: RasterStyleInput): LidarDisplayStyle {
  return RASTER_QUANTITIES[itemType.quantity].style(item)
}

/** Units written straight after the number, without a space (12°, 30%). */
const ATTACHED_UNITS = new Set(['°', '%'])

/** A unit suffix for a formatted number: "°", "%" or " m"; empty when unknown. */
export function unitSuffix(units: string): string {
  if (!units || units === 'unknown') return ''
  return ATTACHED_UNITS.has(units) ? units : ` ${units}`
}
