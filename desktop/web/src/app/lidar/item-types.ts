import type { LibraryItemType, LidarColourRange, LidarRamp, RasterQuantity } from '../../generated/contracts'
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

/**
 * How a profile plots a quantity: elevations share one axis, heights above
 * ground share a second plot below it, and anything else is not profiled.
 */
export type ProfileRole = 'elevation' | 'height'

interface RasterQuantityType {
  readonly labelKey: string
  /** Whether a source can be imported as this quantity; derived-only otherwise. */
  readonly importable: boolean
  readonly profile: ProfileRole | null
  /** The ramp an entry with `ramp: null` draws with. */
  readonly defaultRamp: LidarRamp
  /** The range an entry with `range: null` spans, in the item's own units. */
  defaultRange(units: string): LidarColourRange
  style(item: RasterStyleInput): LidarDisplayStyle
}

const DATA_RANGE = (): LidarColourRange => ({ mode: 'Data' })

const SLOPE_DEGREES_MAX = 30
/** The same 30° expressed in percent, so both units share one colour domain. */
const SLOPE_PERCENT_MAX = Math.round(Math.tan((SLOPE_DEGREES_MAX * Math.PI) / 180) * 1000) / 10

function slopeDomainMax(units: string): number {
  return units === '%' ? SLOPE_PERCENT_MAX : SLOPE_DEGREES_MAX
}

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
    profile: 'elevation',
    defaultRamp: 'Terrain',
    defaultRange: DATA_RANGE,
    // Hypsometric without blue, so blue keeps one meaning on the map: water.
    style: overDisplayRange('schwarzwald'),
  },
  SurfaceElevation: {
    labelKey: 'canvas.lidar.library.quantity.SurfaceElevation',
    importable: true,
    profile: 'elevation',
    defaultRamp: 'Terrain',
    defaultRange: DATA_RANGE,
    style: overDisplayRange('schwarzwald'),
  },
  AboveGroundHeight: {
    labelKey: 'canvas.lidar.library.quantity.AboveGroundHeight',
    importable: true,
    profile: 'height',
    defaultRamp: 'Greens',
    defaultRange: DATA_RANGE,
    style: overDisplayRange('greens'),
  },
  OtherContinuous: {
    labelKey: 'canvas.lidar.library.quantity.OtherContinuous',
    importable: true,
    profile: null,
    defaultRamp: 'Magma',
    defaultRange: DATA_RANGE,
    style: overDisplayRange('viridis'),
  },
  Slope: {
    labelKey: 'canvas.lidar.library.quantity.Slope',
    importable: false,
    profile: null,
    defaultRamp: 'YellowRed',
    // A fixed 0–30° (57.7 % for a percent result), so two slopes compare at a glance.
    defaultRange: (units) => ({ mode: 'Custom', min: 0, max: slopeDomainMax(units) }),
    // A fixed domain in the result's own unit, so a percent result is never
    // coloured as degrees and two slopes compare at a glance.
    style: (item) => ({
      colormap: 'ylorrd',
      reversed: false,
      rescale: [0, slopeDomainMax(item.units)],
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

/**
 * Whether and how the Profile tool plots an item type; the Site data toolbar
 * and the profile's curves ask this instead of naming quantities.
 */
export function profileRole(itemType: LibraryItemType): ProfileRole | null {
  return RASTER_QUANTITIES[itemType.quantity].profile
}

/**
 * What `ramp: null` and `range: null` mean for an item type in its own units.
 * The Site data writer stores a choice equal to these as null, so a default
 * has one encoding and Reset compares once.
 */
export function kindDisplayDefaults(
  itemType: LibraryItemType,
  units: string,
): { readonly ramp: LidarRamp; readonly range: LidarColourRange } {
  const type = RASTER_QUANTITIES[itemType.quantity]
  return { ramp: type.defaultRamp, range: type.defaultRange(units) }
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
