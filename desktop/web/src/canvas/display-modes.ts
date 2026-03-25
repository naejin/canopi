import Konva from 'konva'
import { getStratumColor } from './plants'
import type { PlantDisplayMode, ColorByAttribute } from '../state/canvas'

// ---------------------------------------------------------------------------
// Plant display modes — canopy spread + thematic coloring
// ---------------------------------------------------------------------------

const CIRCLE_SCREEN_PX = 8 // default radius (must match plants.ts)

// Hardiness color gradient (zones 1-13)
const HARDINESS_COLORS: Record<number, string> = {
  1: '#1565C0', 2: '#1976D2', 3: '#2196F3', 4: '#42A5F5',
  5: '#4CAF50', 6: '#66BB6A', 7: '#8BC34A', 8: '#CDDC39',
  9: '#FDD835', 10: '#FFB300', 11: '#FF8F00', 12: '#E65100', 13: '#BF360C',
}

// Lifecycle colors
const LIFECYCLE_COLORS: Record<string, string> = {
  'Annual': '#FF9800',
  'Biennial': '#8BC34A',
  'Perennial': '#2E7D32',
  'Short-lived perennial': '#558B2F',
}

// Nitrogen fixation colors
const NITROGEN_COLORS: Record<string, string> = {
  'Yes': '#1B5E20',
  'High': '#2E7D32',
  'Medium': '#4CAF50',
  'Low': '#8BC34A',
  'No': '#9E9E9E',
  'None': '#9E9E9E',
}

// Edibility colors (0-5 rating)
const EDIBILITY_COLORS: string[] = [
  '#9E9E9E', '#C0CA33', '#8BC34A', '#4CAF50', '#2E7D32', '#1B5E20',
]

export interface LegendEntry {
  label: string
  color: string
}

/**
 * Update all plant nodes for the current display mode.
 * Called when plantDisplayMode or plantColorByAttr changes.
 */
export function updatePlantDisplay(
  plantsLayer: Konva.Layer,
  mode: PlantDisplayMode,
  colorByAttr: ColorByAttribute,
  stageScale: number,
  speciesCache: Map<string, Record<string, unknown>>,
): void {
  plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
    const g = node as Konva.Group
    const circle = g.findOne('Circle') as Konva.Circle | undefined
    if (!circle) return

    const canonicalName = g.getAttr('data-canonical-name') as string

    if (mode === 'default') {
      // Reset to fixed-size strata-colored circles
      const stratum = g.getAttr('data-stratum') as string || null
      circle.radius(CIRCLE_SCREEN_PX)
      circle.fill(getStratumColor(stratum))
    } else if (mode === 'canopy') {
      // Size circle to real canopy spread in world meters
      const canopyM = (g.getAttr('data-canopy-spread') as number) || 0
      if (canopyM > 0) {
        // Group is counter-scaled (scale = 1/stageScale). To show world meters,
        // multiply by stageScale so the visual radius = canopyM/2 in world space.
        circle.radius((canopyM / 2) * stageScale)
      } else {
        circle.radius(CIRCLE_SCREEN_PX) // fallback for plants without spread data
      }
      // Keep strata color in canopy mode
      const stratum = g.getAttr('data-stratum') as string || null
      circle.fill(getStratumColor(stratum))
    } else if (mode === 'color-by') {
      // Reset size to default
      circle.radius(CIRCLE_SCREEN_PX)

      // Stratum can be read directly from the node attr (no cache needed)
      if (colorByAttr === 'stratum') {
        const stratum = g.getAttr('data-stratum') as string || null
        circle.fill(getStratumColor(stratum))
      } else {
        // Other attributes need species detail from cache
        const detail = speciesCache.get(canonicalName)
        const color = _getColorForAttribute(colorByAttr, detail)
        circle.fill(color)
      }
    }
  })

  plantsLayer.batchDraw()
}

/**
 * Generate legend entries for the current color-by attribute.
 */
export function getLegendEntries(attr: ColorByAttribute): LegendEntry[] {
  switch (attr) {
    case 'stratum':
      return Object.entries({
        'Emergent': '#1B5E20', 'High canopy': '#2E7D32', 'Low canopy': '#388E3C',
        'Understory': '#558B2F', 'Shrub': '#7CB342', 'Herbaceous': '#C0CA33',
        'Ground cover': '#D4A843', 'Vine': '#7B1FA2', 'Root': '#6D4C41',
      }).map(([label, color]) => ({ label, color }))
    case 'hardiness':
      return Object.entries(HARDINESS_COLORS).map(([z, color]) => ({
        label: `Zone ${z}`, color,
      }))
    case 'lifecycle':
      return Object.entries(LIFECYCLE_COLORS).map(([label, color]) => ({ label, color }))
    case 'nitrogen':
      return Object.entries(NITROGEN_COLORS)
        .filter(([k]) => k !== 'None') // avoid duplicate for No/None
        .map(([label, color]) => ({ label, color }))
    case 'edibility':
      return EDIBILITY_COLORS.map((color, i) => ({
        label: i === 0 ? 'Not edible' : `Rating ${i}/5`,
        color,
      }))
  }
}

function _getColorForAttribute(
  attr: ColorByAttribute,
  detail: Record<string, unknown> | undefined,
): string {
  if (!detail) return '#9E9E9E'

  switch (attr) {
    case 'stratum':
      return getStratumColor((detail.stratum as string) ?? null)
    case 'hardiness': {
      const zone = (detail.hardiness_zone_min as number) ?? null
      if (zone === null) return '#9E9E9E'
      return HARDINESS_COLORS[zone] ?? '#9E9E9E'
    }
    case 'lifecycle':
      return LIFECYCLE_COLORS[(detail.life_cycle as string) ?? ''] ?? '#9E9E9E'
    case 'nitrogen':
      return NITROGEN_COLORS[(detail.nitrogen_fixation as string) ?? ''] ?? '#9E9E9E'
    case 'edibility': {
      const rating = (detail.edibility_rating as number) ?? 0
      return EDIBILITY_COLORS[Math.min(rating, 5)] ?? '#9E9E9E'
    }
  }
}
