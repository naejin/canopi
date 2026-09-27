import { normalizeHexColor } from '../plant-colors'

/**
 * How plants are shown on the map ("Display on the map" in Plants in this
 * Design). Display never changes stored plant colours or symbols: it only
 * decides which colour, size, outline and label each plant is drawn with.
 */
export type PlantColorMode = 'species' | 'stratum' | 'one-color'
export type PlantLabelMode = 'none' | 'codes' | 'names'
/** The Design's stratum for a species, as Consortium assigns it. */
export type PlantDisplayStratum = 'emergent' | 'high' | 'medium' | 'low'

export interface PlantDisplay {
  readonly colorBy: PlantColorMode
  /** #RRGGBB used for every plant in `one-color` mode. */
  readonly oneColor: string
  /** Multiplies the symbolic plant radius; 1 is the default size. */
  readonly symbolScale: number
  /** Draw the halo around each symbol. */
  readonly outline: boolean
  readonly labels: PlantLabelMode
  /** Consortium stratum per canonical name; absent means "No stratum yet". */
  readonly strata: ReadonlyMap<string, PlantDisplayStratum>
}

export const PLANT_COLOR_MODES: readonly PlantColorMode[] = ['species', 'stratum', 'one-color']
export const PLANT_LABEL_MODES: readonly PlantLabelMode[] = ['none', 'codes', 'names']
export const PLANT_DISPLAY_STRATA: readonly PlantDisplayStratum[] = ['emergent', 'high', 'medium', 'low']

export const PLANT_SYMBOL_SCALE_MIN = 0.5
export const PLANT_SYMBOL_SCALE_MAX = 2

/**
 * Stratum colours: Okabe-Ito hues, told apart with the common colour vision
 * deficiencies, plus a neutral grey for species with no stratum yet. They
 * are plant data colours drawn on the map, so they do not follow the UI theme.
 */
export const STRATUM_DISPLAY_COLORS: { readonly [K in PlantDisplayStratum]: string } = {
  emergent: '#0072B2',
  high: '#009E73',
  medium: '#E69F00',
  low: '#CC79A7',
}
export const NO_STRATUM_DISPLAY_COLOR = '#8C8577'

export const DEFAULT_PLANT_DISPLAY: PlantDisplay = Object.freeze({
  colorBy: 'species',
  oneColor: '#27231D',
  symbolScale: 1,
  outline: true,
  labels: 'names',
  strata: new Map<string, PlantDisplayStratum>(),
})

/** The colour a plant is drawn with: its stored colour, its stratum's, or the one colour. */
export function resolveDisplayedPlantColor(
  storedColor: string,
  canonicalName: string,
  display: PlantDisplay,
): string {
  if (display.colorBy === 'one-color') return display.oneColor
  if (display.colorBy === 'stratum') {
    const stratum = display.strata.get(canonicalName)
    return stratum ? STRATUM_DISPLAY_COLORS[stratum] : NO_STRATUM_DISPLAY_COLOR
  }
  return storedColor
}

export function clampPlantSymbolScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(PLANT_SYMBOL_SCALE_MAX, Math.max(PLANT_SYMBOL_SCALE_MIN, value))
}

/** The next mode for View › Labels (N): None, Codes, Names, then None again. */
export function nextPlantLabelMode(mode: PlantLabelMode): PlantLabelMode {
  return PLANT_LABEL_MODES[(PLANT_LABEL_MODES.indexOf(mode) + 1) % PLANT_LABEL_MODES.length]!
}

export function plantDisplaysEqual(left: PlantDisplay, right: PlantDisplay): boolean {
  if (
    left.colorBy !== right.colorBy
    || left.oneColor !== right.oneColor
    || left.symbolScale !== right.symbolScale
    || left.outline !== right.outline
    || left.labels !== right.labels
    || left.strata.size !== right.strata.size
  ) return false
  for (const [name, stratum] of left.strata) if (right.strata.get(name) !== stratum) return false
  return true
}

/** Normalizes untrusted values (a Design's stored display) to a valid display. */
export function normalizePlantDisplay(value: Partial<PlantDisplay>): PlantDisplay {
  return Object.freeze({
    colorBy: PLANT_COLOR_MODES.includes(value.colorBy as PlantColorMode)
      ? value.colorBy as PlantColorMode
      : DEFAULT_PLANT_DISPLAY.colorBy,
    oneColor: normalizeHexColor(value.oneColor) ?? DEFAULT_PLANT_DISPLAY.oneColor,
    symbolScale: typeof value.symbolScale === 'number'
      ? clampPlantSymbolScale(value.symbolScale)
      : DEFAULT_PLANT_DISPLAY.symbolScale,
    outline: typeof value.outline === 'boolean' ? value.outline : DEFAULT_PLANT_DISPLAY.outline,
    labels: PLANT_LABEL_MODES.includes(value.labels as PlantLabelMode)
      ? value.labels as PlantLabelMode
      : DEFAULT_PLANT_DISPLAY.labels,
    strata: value.strata ?? DEFAULT_PLANT_DISPLAY.strata,
  })
}

// The workspace's plant display, set by the runtime from its app adapter
// (`CanvasRuntimeAppAdapter.plantDisplay`), like the map backdrop. Drawing,
// hit testing, bounds and labels all read it, so they never disagree.
let plantDisplay: PlantDisplay = DEFAULT_PLANT_DISPLAY

/** Returns true when the display changed and the scene must redraw. */
export function setCanvasPlantDisplay(next: PlantDisplay): boolean {
  if (plantDisplaysEqual(plantDisplay, next)) return false
  plantDisplay = next
  return true
}

export function getCanvasPlantDisplay(): PlantDisplay {
  return plantDisplay
}
