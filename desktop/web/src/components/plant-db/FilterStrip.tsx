import { useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import {
  filterOptions,
  hasActiveFilters,
  loadFilterOptions,
  clearFilters,
  activeFilterCount,
  patchFilters,
  plantFilterCatalog,
  plantSearchSession,
} from '../../app/plant-browser'
import type { SpeciesFilter } from '../../types/species'
import { FilterChip } from './FilterChip'
import { ThresholdSlider } from './ThresholdSlider'
import { toggleArrayValue } from './filter-utils'
import styles from './PlantDb.module.css'

function patchFilterValue<K extends keyof SpeciesFilter>(key: K, value: SpeciesFilter[K]): void {
  patchFilters({ [key]: value } as Partial<SpeciesFilter>)
}

export function FilterStrip({ onMoreFilters }: { onMoreFilters: () => void }) {
  void locale.value;
  const opts = filterOptions.value;
  const filters = plantSearchSession.intent.value.filters;
  const showClear = hasActiveFilters.value;
  const count = activeFilterCount.value;

  useEffect(() => {
    void loadFilterOptions();
  }, []);

  return (
    <div className={styles.filterStrip}>
      {plantFilterCatalog.stripControls().map((control) => {
        const label = t(control.labelI18nKey, control.fallbackLabel)

        return (
          <div key={`${control.control}-${control.filterKey}`} className={styles.filterRow}>
            <span className={styles.filterLabel}>{label}</span>
            <div className={styles.filterControl}>
              {control.control === 'choice' && (opts?.[control.optionsKey] ?? []).map((val) => (
                <FilterChip
                  key={val}
                  label={t(`${control.valueI18nPrefix}${val}`, val)}
                  color={control.color}
                  active={(filters[control.filterKey] as string[] | null)?.includes(val) ?? false}
                  onClick={() => patchFilterValue(control.filterKey, toggleArrayValue(filters[control.filterKey] as string[] | null, val) as SpeciesFilter[typeof control.filterKey])}
                />
              ))}
              {control.control === 'threshold' && (
                <ThresholdSlider
                  min={control.min}
                  max={control.max}
                  value={filters[control.filterKey] as number | null}
                  onChange={(value) => patchFilterValue(control.filterKey, value as SpeciesFilter[typeof control.filterKey])}
                  ariaLabel={label}
                />
              )}
              {control.control === 'boolean' && (
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={filters[control.filterKey] === true}
                    onChange={(event) => patchFilterValue(control.filterKey, ((event.target as HTMLInputElement).checked ? true : null) as SpeciesFilter[typeof control.filterKey])}
                  />
                  <span className={styles.toggleTrack} />
                </label>
              )}
            </div>
          </div>
        )
      })}

      <div className={styles.filterActions}>
        <button type="button" className={styles.moreFiltersBtn} onClick={onMoreFilters}>
          {t('filters.moreFilters')}
          {count > 0 && <span className={styles.filterBadge}>{count}</span>}
          <span aria-hidden="true">{'\u203A'}</span>
        </button>
        {showClear && (
          <button type="button" className={styles.clearAllBtn} onClick={clearFilters}>
            {t('filters.clearAll')}
          </button>
        )}
      </div>
    </div>
  );
}
