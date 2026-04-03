import { getStratumColor, STRATUM_I18N_KEY } from './plants'
import { t } from '../i18n'
import type { ColorByAttribute } from '../state/canvas'
import {
  FLOWER_COLOR_ORDER,
  getFlowerColorHex,
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

export interface LegendEntry {
  label: string
  color: string
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
