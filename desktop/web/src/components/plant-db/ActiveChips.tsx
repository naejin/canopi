import { useSignalEffect } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { plantFilterCatalog, speciesCatalogWorkbench } from '../../app/plant-browser'
import type { DynamicFilter, DynamicFilterOptions, SpeciesFilter } from '../../types/species'
import type { ActiveChipField, SpeciesFilterKey } from '../../app/plant-browser'
import { FIELD_REGISTRY, categoryForField } from './field-registry'
import { FilterChip } from './FilterChip'
import { toggleArrayValue } from './filter-utils'
import styles from './PlantDb.module.css'

type Chip = { key: string; label: string; color: string; onDismiss: () => void };

function addArrayChips(
  chips: Chip[],
  filters: SpeciesFilter,
  field: SpeciesFilterKey,
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
      onDismiss: () => speciesCatalogWorkbench.patchFilters({ [field]: toggleArrayValue(filters[field] as string[] | null, v) }),
    });
  }
}

function addCatalogChips(
  chips: Chip[],
  filters: SpeciesFilter,
  fields: readonly ActiveChipField[],
) {
  for (const field of fields) {
    if (field.kind === 'array') {
      addArrayChips(
        chips,
        filters,
        field.filterKey,
        field.keyPrefix,
        field.valueI18nPrefix,
        field.color,
      )
      continue
    }

    if (field.kind === 'boolean') {
      if (filters[field.filterKey] === null) continue
      chips.push({
        key: field.filterKey,
        label: t(field.labelI18nKey, field.fallbackLabel),
        color: field.color,
        onDismiss: () => speciesCatalogWorkbench.patchFilters({ [field.filterKey]: null }),
      })
      continue
    }

    const value = filters[field.filterKey] as number | null
    if (value === null) continue
    chips.push({
      key: field.filterKey,
      label: `${t(field.labelI18nKey, field.fallbackLabel)}: ${value}${field.suffix}`,
      color: field.color,
      onDismiss: () => speciesCatalogWorkbench.patchFilters({ [field.filterKey]: null }),
    })
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

  if (fieldDef?.kind === 'categorical' && cachedValues) {
    const localizedValues = filter.values.map((value) => (
      cachedValues.find((candidate) => candidate.value === value)?.label ?? value
    ))
    return localizedValues.length > 0 ? `${label}: ${localizedValues.join(', ')}` : label
  }

  if (fieldDef?.kind === 'numeric') {
    const formattedValue = formatNumericExtraValue(filter)
    return formattedValue ? `${label}: ${formattedValue}` : label
  }

  return filter.values.length > 0 ? `${label}: ${filter.values.join(', ')}` : label
}

export function ActiveChips() {
  const loc = locale.value;
  const intent = speciesCatalogWorkbench.intent.value;
  const filters = intent.filters;
  const extras = intent.extraFilters;
  const hasAny = speciesCatalogWorkbench.hasActiveFilters.value;
  const dynamicOptions = speciesCatalogWorkbench.dynamicOptions.value;
  const localeOptions = dynamicOptions.cache[loc] ?? {};

  useSignalEffect(() => {
    const currentLoc = locale.value;
    const currentExtras = speciesCatalogWorkbench.intent.value.extraFilters;
    const cache = speciesCatalogWorkbench.dynamicOptions.value.cache[currentLoc] ?? {};

    const seen = new Set<string>();
    const uncachedFields: string[] = [];
    for (const ef of currentExtras) {
      const fieldDef = FIELD_REGISTRY.find((f) => f.key === ef.field);
      if (fieldDef?.kind === 'categorical' && !seen.has(fieldDef.key) && !cache[fieldDef.key]) {
        seen.add(fieldDef.key);
        uncachedFields.push(fieldDef.key);
      }
    }

    if (uncachedFields.length > 0) {
      void speciesCatalogWorkbench.loadDynamicOptions(uncachedFields);
    }
  })

  if (!hasAny) return null;

  const chips: Chip[] = [];

  addCatalogChips(chips, filters, plantFilterCatalog.activeChipFields())

  for (const ef of extras) {
    const cat = categoryForField(ef.field);
    const fieldDef = FIELD_REGISTRY.find((f) => f.key === ef.field);
    const label = fieldDef ? t(fieldDef.i18nKey, ef.field) : ef.field;
    chips.push({
      key: `extra-${ef.field}`,
      label: formatExtraFilterDisplay(ef, label, localeOptions),
      color: cat?.colorToken ?? '--color-primary',
      onDismiss: () => speciesCatalogWorkbench.removeExtraFilter(ef.field),
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
