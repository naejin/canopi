import { useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import {
  activeFilters,
  filterOptions,
  hasActiveFilters,
  loadFilterOptions,
  clearFilters,
  activeFilterCount,
  patchFilters,
} from '../../state/plant-db'
import { FilterChip } from './FilterChip'
import { RangeSlider } from './RangeSlider'
import { ThresholdSlider } from './ThresholdSlider'
import styles from './PlantDb.module.css'

function toggleArrayValue(arr: string[] | null, val: string): string[] | null {
  if (arr === null) return [val];
  if (arr.includes(val)) {
    const next = arr.filter((v) => v !== val);
    return next.length === 0 ? null : next;
  }
  return [...arr, val];
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

  return (
    <div className={styles.filterStrip}>
      {/* Stratum — multi-select chips */}
      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>{t('filters.stratum')}</span>
        <div className={styles.filterControl}>
          {(opts?.strata ?? []).map((s) => (
            <FilterChip
              key={s}
              label={s}
              color="--color-nitrogen"
              active={filters.stratum?.includes(s) ?? false}
              onClick={() => patchFilters({ stratum: toggleArrayValue(filters.stratum, s) })}
            />
          ))}
        </div>
      </div>

      {/* Sun tolerance — multi-select chips */}
      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>{t('filters.sun')}</span>
        <div className={styles.filterControl}>
          {(opts?.sun_tolerances ?? []).map((s) => (
            <FilterChip
              key={s}
              label={t(`plantDb.sunTolerance_${s}`, s)}
              color="--color-sun"
              active={filters.sun_tolerances?.includes(s) ?? false}
              onClick={() => patchFilters({ sun_tolerances: toggleArrayValue(filters.sun_tolerances, s) })}
            />
          ))}
        </div>
      </div>

      {/* Hardiness zone — range slider */}
      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>{t('filters.hardiness')}</span>
        <div className={styles.filterControl}>
          <RangeSlider
            min={opts?.hardiness_range[0] ?? 1}
            max={opts?.hardiness_range[1] ?? 13}
            valueLow={filters.hardiness_min}
            valueHigh={filters.hardiness_max}
            onChangeLow={(v) => patchFilters({ hardiness_min: v })}
            onChangeHigh={(v) => patchFilters({ hardiness_max: v })}
            ariaLabel={t('filters.hardiness')}
          />
        </div>
      </div>

      {/* Edibility — threshold slider */}
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

      {/* Height range — range slider */}
      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>{t('filters.height')}</span>
        <div className={styles.filterControl}>
          <RangeSlider
            min={0}
            max={50}
            valueLow={filters.height_min}
            valueHigh={filters.height_max}
            onChangeLow={(v) => patchFilters({ height_min: v })}
            onChangeHigh={(v) => patchFilters({ height_max: v })}
            step={0.5}
            formatLabel={(v) => `${v}m`}
            ariaLabel={t('filters.height')}
          />
        </div>
      </div>

      {/* Nitrogen fixer — toggle switch */}
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

      {/* Bottom row: More filters + Clear */}
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
