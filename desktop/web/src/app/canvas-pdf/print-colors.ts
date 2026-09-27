import type { PrintPlant } from '../../canvas/print'
import { hexLuminance, normalizeHexColor } from '../../canvas/plant-colors'
import { PRINT } from './print-style'
import type { PdfPlantColors } from './types'

// Grayscale levels span dark ink to the lightest grey that keeps 3:1 contrast on white paper.
const DARKEST = 0x2a, LIGHTEST = 0x94

/**
 * Print colour for each authored plant colour. Grayscale gives every distinct colour its own
 * grey, ordered by the original luminance, so the same species keeps one grey on every page.
 */
export function printPlantColors(plants: readonly PrintPlant[], mode: PdfPlantColors = 'design'): ReadonlyMap<string, string> {
  const colors = [...new Set(plants.map(p => p.color))]
  if (mode === 'design') return new Map(colors.map(color => [color, color]))
  if (mode === 'black') return new Map(colors.map(color => [color, PRINT.ink]))
  const keyed = [...new Set(colors.map(key))].sort((a, b) => luminance(a) - luminance(b) || a.localeCompare(b))
  const levels = new Map(keyed.map((color, rank) => [color, keyed.length === 1 ? Math.round((DARKEST + LIGHTEST) / 2)
    : Math.round(DARKEST + (LIGHTEST - DARKEST) * rank / (keyed.length - 1))]))
  return new Map(colors.map(color => {
    const level = levels.get(key(color))!.toString(16).padStart(2, '0')
    return [color, `#${level}${level}${level}`]
  }))
}

export function recolorPlants(plants: readonly PrintPlant[], mode: PdfPlantColors = 'design'): readonly PrintPlant[] {
  if (mode === 'design') return plants
  const colors = printPlantColors(plants, mode)
  return plants.map(plant => ({ ...plant, color: colors.get(plant.color)! }))
}

function key(color: string): string { return normalizeHexColor(color) ?? color.trim().toLowerCase() }
function luminance(color: string): number { return normalizeHexColor(color) ? hexLuminance(color) : 0 }
