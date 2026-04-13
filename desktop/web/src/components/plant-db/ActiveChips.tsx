import { useSignalEffect } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import {
  activeFilters,
  dynamicOptionsCache,
  extraFilters,
  hasActiveFilters,
  loadDynamicOptions,
  patchFilters,
  removeExtraFilter,
} from '../../app/plant-browser'
import type { DynamicFilter, DynamicFilterOptions, SpeciesFilter } from '../../types/species'
import { FIELD_REGISTRY, categoryForField } from './field-registry'
import { FilterChip } from './FilterChip'
import { toggleArrayValue } from './filter-utils'
import styles from './PlantDb.module.css'

type Chip = { key: string; label: string; color: string; onDismiss: () => void };

function addArrayChips(
  chips: Chip[],
  filters: SpeciesFilter,
  field: keyof SpeciesFilter,
  prefix: string,
  i18nPrefix: string,
  color: string,
) {
  const values = filters[field] as string[] | null;
  if (!values) return;
  for (const v of values) {
    chips.push({
      key: `${prefix}-${v}`,
      label: t(`${i18nPrefix}${v}`, v),
      color,
      onDismiss: () => patchFilters({ [field]: toggleArrayValue(filters[field] as string[] | null, v) }),
    });
  }
}

function formatNumericExtraValue(filter: DynamicFilter): string | null {
  const [low, high] = filter.values;

  switch (filter.op) {
    case 'Equals':
      return low ?? null
    case 'Gte':
      return low != null ? `>= ${low}` : null
    case 'Lte':
      return low != null ? `<= ${low}` : null
    case 'Between':
      if (low != null && high != null) return low === high ? low : `${low}\u2013${high}`
      return low ?? high ?? null
    default:
      return null
  }
}

function formatExtraFilterDisplay(
  filter: DynamicFilter,
  label: string,
  localeOptions: Record<string, DynamicFilterOptions>,
): string {
  const fieldDef = FIELD_REGISTRY.find((field) => field.key === filter.field)
  const cachedValues = localeOptions[filter.field]?.values

  if (fieldDef?.type === 'categorical' && cachedValues) {
    const localizedValues = filter.values.map((value) => (
      cachedValues.find((candidate) => candidate.value === value)?.label ?? value
    ))
    return localizedValues.length > 0 ? `${label}: ${localizedValues.join(', ')}` : label
  }

  if (fieldDef?.type === 'numeric') {
    const formattedValue = formatNumericExtraValue(filter)
    return formattedValue ? `${label}: ${formattedValue}` : label
  }

  return filter.values.length > 0 ? `${label}: ${filter.values.join(', ')}` : label
}

export function ActiveChips() {
  const loc = locale.value;
  const filters = activeFilters.value;
  const extras = extraFilters.value;
  const hasAny = hasActiveFilters.value;
  const localeOptions = dynamicOptionsCache.value[loc] ?? {};

  useSignalEffect(() => {
    const currentLoc = locale.value;
    const currentExtras = extraFilters.value;
    const cache = dynamicOptionsCache.value[currentLoc] ?? {};

    const seen = new Set<string>();
    const uncachedFields: string[] = [];
    for (const ef of currentExtras) {
      const fieldDef = FIELD_REGISTRY.find((f) => f.key === ef.field);
      if (fieldDef?.type === 'categorical' && !seen.has(fieldDef.key) && !cache[fieldDef.key]) {
        seen.add(fieldDef.key);
        uncachedFields.push(fieldDef.key);
      }
    }

    if (uncachedFields.length > 0) {
      void loadDynamicOptions(uncachedFields);
    }
  })

  if (!hasAny) return null;

  const chips: Chip[] = [];

  addArrayChips(chips, filters, 'climate_zones', 'cz', 'filters.climateZone_', '--color-sun');
  addArrayChips(chips, filters, 'habit', 'hab', 'filters.habit_', '--color-family');
  addArrayChips(chips, filters, 'sun_tolerances', 'sun', 'plantDb.sunTolerance_', '--color-sun');
  addArrayChips(chips, filters, 'life_cycle', 'lc', 'filters.lifeCycle_', '--color-family');
  addArrayChips(chips, filters, 'growth_rate', 'gr', 'filters.growthRate_', '--color-family');

  if (filters.woody !== null) {
    chips.push({
      key: 'woody',
      label: t('filters.woody'),
      color: '--color-family',
      onDismiss: () => patchFilters({ woody: null }),
    });
  }

  if (filters.edibility_min !== null) {
    chips.push({
      key: 'edibility',
      label: `${t('filters.edibility')}: ${filters.edibility_min}+`,
      color: '--color-edible',
      onDismiss: () => patchFilters({ edibility_min: null }),
    });
  }

  if (filters.nitrogen_fixer !== null) {
    chips.push({
      key: 'nitrogen',
      label: t('filters.nitrogen'),
      color: '--color-nitrogen',
      onDismiss: () => patchFilters({ nitrogen_fixer: null }),
    });
  }

  for (const ef of extras) {
    const cat = categoryForField(ef.field);
    const fieldDef = FIELD_REGISTRY.find((f) => f.key === ef.field);
    const label = fieldDef ? t(fieldDef.i18nKey, ef.field) : ef.field;
    chips.push({
      key: `extra-${ef.field}`,
      label: formatExtraFilterDisplay(ef, label, localeOptions),
      color: cat?.color ?? '--color-primary',
      onDismiss: () => removeExtraFilter(ef.field),
    });
  }

  return (
    <div className={styles.activeChips} role="list" aria-label={t('filters.activeFilters', 'Active filters')}>
      {chips.map((chip) => (
        <FilterChip
          key={chip.key}
          label={chip.label}
          color={chip.color}
          active
          onDismiss={chip.onDismiss}
        />
      ))}
    </div>
  );
}
