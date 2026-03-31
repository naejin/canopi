import { useSignalEffect } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import {
  activeFilters,
  dynamicOptionsCache,
  extraFilters,
  hasActiveFilters,
  loadDynamicOptions,
  patchFilters,
  removeExtraFilter,
} from '../../state/plant-db'
import { FIELD_REGISTRY, categoryForField } from './field-registry'
import { FilterChip } from './FilterChip'
import styles from './PlantDb.module.css'

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

  const chips: { key: string; label: string; color: string; onDismiss: () => void }[] = [];

  // Stratum chips
  if (filters.stratum) {
    for (const s of filters.stratum) {
      chips.push({
        key: `stratum-${s}`,
        label: t(`filters.stratum_${s}`, s),
        color: '--color-nitrogen',
        onDismiss: () => {
          const next = (filters.stratum ?? []).filter((v) => v !== s);
          patchFilters({ stratum: next.length ? next : null });
        },
      });
    }
  }

  // Sun chips
  if (filters.sun_tolerances) {
    for (const s of filters.sun_tolerances) {
      chips.push({
        key: `sun-${s}`,
        label: t(`plantDb.sunTolerance_${s}`, s),
        color: '--color-sun',
        onDismiss: () => {
          const next = (filters.sun_tolerances ?? []).filter((v) => v !== s);
          patchFilters({ sun_tolerances: next.length ? next : null });
        },
      });
    }
  }

  // Hardiness
  if (filters.hardiness_min !== null || filters.hardiness_max !== null) {
    const label = `${t('filters.hardiness')}: ${filters.hardiness_min ?? '?'}\u2013${filters.hardiness_max ?? '?'}`;
    chips.push({
      key: 'hardiness',
      label,
      color: '--color-hardiness',
      onDismiss: () => patchFilters({ hardiness_min: null, hardiness_max: null }),
    });
  }

  // Edibility
  if (filters.edibility_min !== null) {
    chips.push({
      key: 'edibility',
      label: `${t('filters.edibility')}: ${filters.edibility_min}+`,
      color: '--color-edible',
      onDismiss: () => patchFilters({ edibility_min: null }),
    });
  }

  // Height
  if (filters.height_min !== null || filters.height_max !== null) {
    const label = `${t('filters.height')}: ${filters.height_min ?? 0}\u2013${filters.height_max ?? '\u221E'}m`;
    chips.push({
      key: 'height',
      label,
      color: '--color-height',
      onDismiss: () => patchFilters({ height_min: null, height_max: null }),
    });
  }

  // Nitrogen fixer
  if (filters.nitrogen_fixer !== null) {
    chips.push({
      key: 'nitrogen',
      label: t('filters.nitrogen'),
      color: '--color-nitrogen',
      onDismiss: () => patchFilters({ nitrogen_fixer: null }),
    });
  }

  // Life cycle (also in FilterStrip, chips here for dismissal)
  if (filters.life_cycle) {
    for (const lc of filters.life_cycle) {
      chips.push({
        key: `lc-${lc}`,
        label: t(`filters.lifeCycle_${lc}`, lc),
        color: '--color-family',
        onDismiss: () => {
          const next = (filters.life_cycle ?? []).filter((v) => v !== lc);
          patchFilters({ life_cycle: next.length ? next : null });
        },
      });
    }
  }

  if (filters.growth_rate) {
    for (const gr of filters.growth_rate) {
      chips.push({
        key: `gr-${gr}`,
        label: t(`filters.growthRate_${gr}`, gr),
        color: '--color-family',
        onDismiss: () => {
          const next = (filters.growth_rate ?? []).filter((v) => v !== gr);
          patchFilters({ growth_rate: next.length ? next : null });
        },
      });
    }
  }

  // Extra (dynamic) filters
  for (const ef of extras) {
    const cat = categoryForField(ef.field);
    const fieldDef = FIELD_REGISTRY.find((f) => f.key === ef.field);
    const label = fieldDef ? t(fieldDef.i18nKey, ef.field) : ef.field;
    const cachedValues = localeOptions[ef.field]?.values;
    const localizedValues = fieldDef?.type === 'categorical' && cachedValues
      ? ef.values.map((v) => cachedValues.find((cv) => cv.value === v)?.label ?? v)
      : ef.values;
    const display = localizedValues.length > 0 ? `${label}: ${localizedValues.join(', ')}` : label;
    chips.push({
      key: `extra-${ef.field}`,
      label: display,
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
