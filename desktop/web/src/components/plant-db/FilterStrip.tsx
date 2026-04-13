import { useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../app/shell/state'
import {
  activeFilters,
  filterOptions,
  hasActiveFilters,
  loadFilterOptions,
  clearFilters,
  activeFilterCount,
  patchFilters,
} from '../../app/plant-browser'
import type { SpeciesFilter } from '../../types/species'
import { FilterChip } from './FilterChip'
import { ThresholdSlider } from './ThresholdSlider'
import { toggleArrayValue } from './filter-utils'
import styles from './PlantDb.module.css'

interface ChipRowConfig {
  label: string
  options: string[]
  filterKey: keyof SpeciesFilter
  i18nPrefix: string
  color: string
}

export function FilterStrip({ onMoreFilters }: { onMoreFilters: () => void }) {
  void locale.value;
  const opts = filterOptions.value;
  const filters = activeFilters.value;
  const showClear = hasActiveFilters.value;
  const count = activeFilterCount.value;

  useEffect(() => {
    void loadFilterOptions();
  }, []);

  const chipRows: ChipRowConfig[] = [
    { label: t('filters.climateZone'), options: opts?.climate_zones ?? [], filterKey: 'climate_zones', i18nPrefix: 'filters.climateZone_', color: '--color-sun' },
    { label: t('filters.habit'), options: opts?.habits ?? [], filterKey: 'habit', i18nPrefix: 'filters.habit_', color: '--color-family' },
    { label: t('filters.sun'), options: opts?.sun_tolerances ?? [], filterKey: 'sun_tolerances', i18nPrefix: 'plantDb.sunTolerance_', color: '--color-sun' },
    { label: t('filters.lifecycle'), options: opts?.life_cycles ?? [], filterKey: 'life_cycle', i18nPrefix: 'filters.lifeCycle_', color: '--color-family' },
  ];

  return (
    <div className={styles.filterStrip}>
      {chipRows.map((row) => (
        <div key={row.filterKey} className={styles.filterRow}>
          <span className={styles.filterLabel}>{row.label}</span>
          <div className={styles.filterControl}>
            {row.options.map((val) => (
              <FilterChip
                key={val}
                label={t(`${row.i18nPrefix}${val}`, val)}
                color={row.color}
                active={(filters[row.filterKey] as string[] | null)?.includes(val) ?? false}
                onClick={() => patchFilters({ [row.filterKey]: toggleArrayValue(filters[row.filterKey] as string[] | null, val) })}
              />
            ))}
          </div>
        </div>
      ))}

      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>{t('filters.edibility')}</span>
        <div className={styles.filterControl}>
          <ThresholdSlider
            min={0}
            max={5}
            value={filters.edibility_min}
            onChange={(v) => patchFilters({ edibility_min: v })}
            ariaLabel={t('filters.edibility')}
          />
        </div>
      </div>

      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>{t('filters.woody')}</span>
        <div className={styles.filterControl}>
          <label className={styles.toggleSwitch}>
            <input
              type="checkbox"
              checked={filters.woody === true}
              onChange={(e) => patchFilters({ woody: (e.target as HTMLInputElement).checked ? true : null })}
            />
            <span className={styles.toggleTrack} />
          </label>
        </div>
      </div>

      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>{t('filters.nitrogen')}</span>
        <div className={styles.filterControl}>
          <label className={styles.toggleSwitch}>
            <input
              type="checkbox"
              checked={filters.nitrogen_fixer === true}
              onChange={(e) => patchFilters({ nitrogen_fixer: (e.target as HTMLInputElement).checked ? true : null })}
            />
            <span className={styles.toggleTrack} />
          </label>
        </div>
      </div>

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
