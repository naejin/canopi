// ---------------------------------------------------------------------------
// Contour line configuration for MapLibre terrain rendering.
//
// Uses `maplibre-contour` to generate contour isolines client-side from
// AWS Terrain Tiles (raster-dem, Terrarium encoding). The DemSource registers
// a custom protocol with MapLibre, which we consume as a vector-tile source
// in the map style.
//
// AD: Contour intervals are adaptive by zoom, with an optional user override
// via the contour interval signal in app/canvas-settings/signals.
// ---------------------------------------------------------------------------

/**
 * Contour tile options matching the maplibre-contour API.
 * Defined here to avoid deep path imports from the package.
 */
interface ContourThresholds {
  [zoom: number]: number | number[]
}

interface ContourProtocolOptions {
  thresholds: ContourThresholds
  elevationKey?: string
  levelKey?: string
  contourLayer?: string
  overzoom?: number
}

// ── Interval ladder ─────────────────────────────────────────────────────────

/** Default zoom-adaptive contour thresholds: [minor, major] intervals in meters. */
const DEFAULT_THRESHOLDS: ContourThresholds = {
  // zoom < 8 → 100m minor, 500m major
  0: [100, 500],
  // zoom 8-11 → 50m minor, 250m major
  8: [50, 250],
  // zoom 12-13 → 20m minor, 100m major
  12: [20, 100],
  // zoom 14-15 → 10m minor, 50m major
  14: [10, 50],
  // zoom 16+ → 5m minor, 25m major
  16: [5, 25],
}

/**
 * Build zoom→threshold map for a given user interval override.
 * When the user sets a fixed interval, minor = interval, major = interval * 5.
 */
function thresholdsForInterval(interval: number): ContourThresholds {
  return { 0: [interval, interval * 5] }
}

// ── Source + Layer configs ──────────────────────────────────────────────────

/** AWS Terrain Tiles — free, no API key, Terrarium encoding. */
export const DEM_TILES_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
export const DEM_MAX_ZOOM = 15
export const DEM_ENCODING = 'terrarium' as const

/**
 * Return the contour protocol URL and source configuration for MapLibre.
 *
 * @param contourProtocolUrl - the URL builder from DemSource (after setupMaplibre)
 * @param userInterval - optional user override interval in meters (0 = use adaptive)
 */
export function getContourSourceConfig(
  contourProtocolUrl: (options: ContourProtocolOptions) => string,
  userInterval: number,
): { tiles: string[]; type: 'vector'; maxzoom: number } {
  const thresholds = userInterval > 0
    ? thresholdsForInterval(userInterval)
    : DEFAULT_THRESHOLDS

  const url = contourProtocolUrl({
    thresholds,
    elevationKey: 'ele',
    levelKey: 'level',
    contourLayer: 'contours',
    overzoom: 1,
  })

  return {
    tiles: [url],
    type: 'vector' as const,
    maxzoom: DEM_MAX_ZOOM + 1,
  }
}

// ── Field notebook contour styling ──────────────────────────────────────────

// Colors matching the field-notebook aesthetic from global.css tokens
const INK_COLOR = '#2C2418'         // var(--color-ink) equivalent
const MUTED_COLOR = '#7D6F5E'      // var(--color-text-muted) equivalent
const INK_COLOR_DARK = '#D4C8B0'   // dark mode ink
const MUTED_COLOR_DARK = '#8B7D6B' // dark mode muted

/**
 * Return MapLibre layer configs for major and minor contour lines.
 * The source must have a `contours` vector layer with `ele` and `level` properties.
 *
 * @param isDark - whether the current theme is dark
 */
export function getContourLayerConfigs(isDark: boolean) {
  const inkColor = isDark ? INK_COLOR_DARK : INK_COLOR
  const mutedColor = isDark ? MUTED_COLOR_DARK : MUTED_COLOR

  return {
    minor: {
      id: 'contour-minor',
      type: 'line' as const,
      source: 'contour-source',
      'source-layer': 'contours',
      filter: ['==', ['get', 'level'], 0],
      paint: {
        'line-color': mutedColor,
        'line-width': 0.5,
        'line-opacity': 0.6,
      },
      layout: {
        visibility: 'visible' as const,
      },
    },
    major: {
      id: 'contour-major',
      type: 'line' as const,
      source: 'contour-source',
      'source-layer': 'contours',
      filter: ['==', ['get', 'level'], 1],
      paint: {
        'line-color': inkColor,
        'line-width': 1.5,
        'line-opacity': 0.8,
      },
      layout: {
        visibility: 'visible' as const,
      },
    },
  }
}

/**
 * Given a contour interval, return [minor, major] intervals.
 * Major lines appear every 5th minor interval.
 */
export function getMajorMinorInterval(interval: number): [number, number] {
  return [interval, interval * 5]
}

// ── Hillshade paint config ──────────────────────────────────────────────────

/**
 * Return MapLibre hillshade layer config using warm field-notebook colors.
 */
export function getHillshadeLayerConfig(exaggeration: number) {
  return {
    id: 'hillshade-layer',
    type: 'hillshade' as const,
    source: 'terrain-dem',
    paint: {
      'hillshade-shadow-color': '#5a4a3a',     // warm brown shadow
      'hillshade-highlight-color': '#faf7f2',   // linen highlight
      'hillshade-accent-color': '#8b7355',      // warm accent
      'hillshade-exaggeration': exaggeration,
      'hillshade-illumination-direction': 315,
      'hillshade-illumination-anchor': 'viewport' as const,
    },
    layout: {
      visibility: 'visible' as const,
    },
  }
}
