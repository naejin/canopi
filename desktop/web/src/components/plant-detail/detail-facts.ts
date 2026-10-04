import { t } from '../../i18n'
import type { SpeciesDetail } from '../../types/species'
import {
  formatHardiness,
  formatList,
  formatMetreRange,
  formatNumber,
  formatRating,
  formatYears,
  joinRecorded,
  presentCatalogValue,
  type SpeciesFact,
} from '../species-detail/species-facts'

/**
 * The Desktop key facts, always in this order and always shown: form and stratum, size,
 * hardiness, light, soil and moisture, growth and succession, then the three ratings.
 */
export function desktopSpeciesFacts(d: SpeciesDetail, locale: string): SpeciesFact[] {
  const light = [
    d.tolerates_full_sun ? t('plantDetail.fullSun') : null,
    d.tolerates_semi_shade ? t('plantDetail.semiShade') : null,
    d.tolerates_full_shade ? t('plantDetail.fullShade') : null,
  ].filter((value): value is string => value !== null)
  const textures = [
    d.tolerates_light_soil ? t('plantDetail.soilLight') : null,
    d.tolerates_medium_soil ? t('plantDetail.soilMedium') : null,
    d.tolerates_heavy_soil ? t('plantDetail.soilHeavy') : null,
  ].filter((value): value is string => value !== null)
  const ph = d.soil_ph_min !== null && d.soil_ph_max !== null && d.soil_ph_min !== d.soil_ph_max
    ? `pH ${formatNumber(d.soil_ph_min, locale)}–${formatNumber(d.soil_ph_max, locale)}`
    : d.soil_ph_min !== null || d.soil_ph_max !== null
      ? `pH ${formatNumber((d.soil_ph_min ?? d.soil_ph_max)!, locale)}`
      : null
  const maturity = d.age_of_maturity_years === null
    ? null
    : t('plantDetail.matureAt', { age: formatYears(d.age_of_maturity_years, locale) })

  return [
    { id: 'habit', label: t('plantDetail.habit'), value: d.habit },
    { id: 'stratum', label: t('plantDetail.stratum'), value: presentCatalogValue('stratum', d.stratum) },
    { id: 'height', label: t('plantDetail.height'), value: formatMetreRange(d.height_min_m, d.height_max_m, locale) },
    { id: 'width', label: t('plantDetail.width'), value: formatMetreRange(null, d.width_max_m, locale) },
    { id: 'hardiness', label: t('plantDetail.hardiness'), value: formatHardiness(d.hardiness_zone_min, d.hardiness_zone_max, locale) },
    { id: 'light', label: t('plantDetail.light'), value: light.length > 0 ? formatList(light, locale) : null },
    { id: 'soil', label: t('plantDetail.soil'), value: joinRecorded([textures.length > 0 ? formatList(textures, locale) : null, ph]) },
    { id: 'moisture', label: t('plantDetail.moisture'), value: d.moisture_use },
    { id: 'drought', label: t('plantDetail.droughtTolerance'), value: d.drought_tolerance },
    { id: 'growth', label: t('plantDetail.growth'), value: joinRecorded([d.growth_rate, maturity, d.lifespan]) },
    { id: 'succession', label: t('plantDetail.successionStage'), value: presentCatalogValue('succession', d.succession_stage) },
    { id: 'edibility', label: t('plantDetail.edible'), value: formatRating(d.edibility_rating, locale) },
    { id: 'medicinal', label: t('plantDetail.medicinal'), value: formatRating(d.medicinal_rating, locale) },
    { id: 'otherUses', label: t('plantDetail.otherUses'), value: formatRating(d.other_uses_rating, locale) },
  ]
}

/** Distinct use categories as read-only tags, in catalog order. */
export function speciesUseTags(d: SpeciesDetail): string[] {
  return [...new Set(d.uses.map(use => use.use_category.trim()).filter(category => category.length > 0))]
}
