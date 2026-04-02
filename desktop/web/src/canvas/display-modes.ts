import Konva from 'konva'
import { getStratumColor, STRATUM_I18N_KEY, CIRCLE_SCREEN_PX } from './plants'
import { t } from '../i18n'
import type { PlantSizeMode, ColorByAttribute } from '../state/canvas'
import {
  FLOWER_COLOR_ORDER,
  getFlowerColorHex,
  normalizeHexColor,
  UNKNOWN_FLOWER_COLOR,
} from './plant-colors'

// ---------------------------------------------------------------------------
// Plant display modes — canopy spread + thematic coloring
// ---------------------------------------------------------------------------


// Hardiness color gradient (zones 1-13)
const HARDINESS_COLORS: Record<number, string> = {
  1: '#1565C0', 2: '#1976D2', 3: '#2196F3', 4: '#42A5F5',
  5: '#4CAF50', 6: '#66BB6A', 7: '#8BC34A', 8: '#CDDC39',
  9: '#FDD835', 10: '#FFB300', 11: '#FF8F00', 12: '#E65100', 13: '#BF360C',
}

// Lifecycle colors (derived from boolean fields)
const LIFECYCLE_COLORS = {
  annual: '#FF9800',
  biennial: '#8BC34A',
  perennial: '#2E7D32',
  multi: '#558B2F',
} as const

// Nitrogen fixer colors (boolean, with unknown for null)
const NITROGEN_FIXER_COLOR = '#1B5E20'
const NITROGEN_NON_FIXER_COLOR = '#9E9E9E'
const NITROGEN_UNKNOWN_COLOR = '#BDBDBD'

// Edibility colors (0-5 rating)
const EDIBILITY_COLORS: string[] = [
  '#9E9E9E', '#C0CA33', '#8BC34A', '#4CAF50', '#2E7D32', '#1B5E20',
]

function getPlantBaseColor(group: Konva.Group): string {
  const override = normalizeHexColor(group.getAttr('data-color-override') as string | null | undefined)
  if (override) return override
  return getStratumColor((group.getAttr('data-stratum') as string) || null)
}

export interface LegendEntry {
  label: string
  color: string
}

/**
 * Update all plant nodes for the current display mode.
 * Called when plant size mode or color-by changes.
 */
export function updatePlantDisplay(
  plantsLayer: Konva.Layer,
  sizeMode: PlantSizeMode,
  colorByAttr: ColorByAttribute | null,
  stageScale: number,
  zoomReference: number,
  speciesCache: Map<string, Record<string, unknown>>,
): void {
  plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
    const g = node as Konva.Group
    const circle = g.findOne('Circle') as Konva.Circle | undefined
    if (!circle) return

    const canonicalName = g.getAttr('data-canonical-name') as string

    if (sizeMode === 'default') {
      // Reset to fixed-size strata-colored circles
      circle.radius(CIRCLE_SCREEN_PX)
      circle.fill(colorByAttr === null ? getPlantBaseColor(g) : resolveColorByValue(g, colorByAttr, canonicalName, speciesCache))
    } else if (sizeMode === 'canopy') {
      // Size circle to real canopy spread in world meters
      const canopyM = (g.getAttr('data-canopy-spread') as number) || 0
      if (canopyM > 0) {
        // Group is counter-scaled (scale = 1/stageScale). To show world meters,
        // multiply by stageScale so the visual radius = canopyM/2 in world space.
        circle.radius((canopyM / 2) * stageScale)
      } else {
        // Match the current default visual size at reference zoom, but keep the
        // fallback in world space so it scales coherently with canopy zoom.
        const referenceScale = zoomReference > 0 ? zoomReference : stageScale
        const fallbackWorldRadius = CIRCLE_SCREEN_PX / referenceScale
        circle.radius(fallbackWorldRadius * stageScale)
      }
      circle.fill(colorByAttr === null ? getPlantBaseColor(g) : resolveColorByValue(g, colorByAttr, canonicalName, speciesCache))
    }
  })

  plantsLayer.batchDraw()
}

function resolveColorByValue(
  group: Konva.Group,
  colorByAttr: ColorByAttribute,
  canonicalName: string,
  speciesCache: Map<string, Record<string, unknown>>,
): string {
  if (colorByAttr === 'stratum') {
    const stratum = group.getAttr('data-stratum') as string || null
    return getStratumColor(stratum)
  }
  const detail = speciesCache.get(canonicalName)
  return getColorForAttribute(colorByAttr, detail)
}

/**
 * Generate legend entries for the current color-by attribute.
 */
export function getLegendEntries(attr: ColorByAttribute): LegendEntry[] {
  switch (attr) {
    case 'stratum':
      return Object.entries(STRATUM_I18N_KEY).map(([dbValue, i18nKey]) => ({
        label: t(i18nKey),
        color: getStratumColor(dbValue),
      }))
    case 'hardiness':
      return Object.entries(HARDINESS_COLORS).map(([z, color]) => ({
        label: `${t('filters.hardiness')} ${z}`, color,
      }))
    case 'lifecycle':
      return [
        { label: t('filters.lifeCycle_Perennial'), color: LIFECYCLE_COLORS.perennial },
        { label: t('filters.lifeCycle_Biennial'), color: LIFECYCLE_COLORS.biennial },
        { label: t('filters.lifeCycle_Annual'), color: LIFECYCLE_COLORS.annual },
        { label: t('filters.lifeCycle_Multiple', 'Multiple'), color: LIFECYCLE_COLORS.multi },
      ]
    case 'nitrogen':
      return [
        { label: t('filters.nitrogenFixer', 'Nitrogen fixer'), color: NITROGEN_FIXER_COLOR },
        { label: t('filters.nitrogenNonFixer', 'Non-fixer'), color: NITROGEN_NON_FIXER_COLOR },
        { label: t('filters.unknown', 'Unknown'), color: NITROGEN_UNKNOWN_COLOR },
      ]
    case 'edibility':
      return EDIBILITY_COLORS.map((color, i) => ({
        label: i === 0 ? t('filters.notEdible', 'Not edible') : `${t('plantDb.edible', 'Edible')} ${i}/5`,
        color,
      }))
    case 'flower':
      return FLOWER_COLOR_ORDER.map((name) => ({
        label: t(`canvas.plantColor.names.${name.toLowerCase()}`, name),
        color: getFlowerColorHex(name) ?? UNKNOWN_FLOWER_COLOR,
      }))
  }
}

export function getColorForAttribute(
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
    case 'lifecycle': {
      const isAnnual = (detail.is_annual as boolean) ?? false
      const isBiennial = (detail.is_biennial as boolean) ?? false
      const isPerennial = (detail.is_perennial as boolean) ?? false
      const count = [isAnnual, isBiennial, isPerennial].filter(Boolean).length
      if (count > 1) return LIFECYCLE_COLORS.multi
      if (isPerennial) return LIFECYCLE_COLORS.perennial
      if (isBiennial) return LIFECYCLE_COLORS.biennial
      if (isAnnual) return LIFECYCLE_COLORS.annual
      return '#9E9E9E'
    }
    case 'nitrogen': {
      const fixer = detail.nitrogen_fixer as boolean | null | undefined
      if (fixer === true) return NITROGEN_FIXER_COLOR
      if (fixer === false) return NITROGEN_NON_FIXER_COLOR
      return NITROGEN_UNKNOWN_COLOR
    }
    case 'edibility': {
      const rating = (detail.edibility_rating as number) ?? 0
      return EDIBILITY_COLORS[Math.min(rating, 5)] ?? '#9E9E9E'
    }
    case 'flower': {
      const resolved = detail.resolved_flower_color as string | null | undefined
      return getFlowerColorHex(resolved) ?? UNKNOWN_FLOWER_COLOR
    }
  }
}
