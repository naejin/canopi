import { useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { speciesCatalogWorkbench } from '../../app/plant-browser'
import type { FilterOptions, SpeciesFilter } from '../../types/species'
import type { StripControlField } from '../../app/plant-browser'
import { FilterChip } from './FilterChip'
import { ThresholdSlider } from './ThresholdSlider'
import { toggleArrayValue } from './filter-utils'
import styles from './PlantDb.module.css'

export function FilterStrip({ onMoreFilters }: { onMoreFilters: () => void }) {
  void locale.value;
  const filterStrip = speciesCatalogWorkbench.filterStrip.value;

  useEffect(() => {
    void speciesCatalogWorkbench.loadFilterOptions();
  }, []);

  return (
    <div className={styles.filterStrip}>
      {filterStrip.controls.map((control) => (
        <FilterControlRow
          key={control.filterKey}
          control={control}
          filters={filterStrip.filters}
          options={filterStrip.options}
        />
      ))}

      <div className={styles.filterActions}>
        <button type="button" className={styles.moreFiltersBtn} onClick={onMoreFilters}>
          {t('filters.moreFilters')}
          {filterStrip.activeCount > 0 && <span className={styles.filterBadge}>{filterStrip.activeCount}</span>}
          <span aria-hidden="true">{'\u203A'}</span>
        </button>
        {filterStrip.hasActive && (
          <button type="button" className={styles.clearAllBtn} onClick={speciesCatalogWorkbench.clearFilters}>
            {t('filters.clearAll')}
          </button>
        )}
      </div>
    </div>
  );
}

function FilterControlRow({
  control,
  filters,
  options,
}: {
  control: StripControlField
  filters: SpeciesFilter
  options: FilterOptions | null
}) {
  const label = t(control.labelI18nKey, control.fallbackLabel)

  return (
    <div className={styles.filterRow}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.filterControl}>
        {control.kind === 'choice' && (options?.[control.optionsKey] ?? []).map((val) => (
          <FilterChip
            key={val}
            label={t(`${control.valueI18nPrefix}${val}`, val)}
            color={control.color}
            active={(filters[control.filterKey] as string[] | null)?.includes(val) ?? false}
            onClick={() => speciesCatalogWorkbench.patchFilters({
              [control.filterKey]: toggleArrayValue(filters[control.filterKey] as string[] | null, val),
            })}
          />
        ))}
        {control.kind === 'threshold' && (
          <ThresholdSlider
            min={control.min}
            max={control.max}
            value={filters[control.filterKey] as number | null}
            onChange={(v) => speciesCatalogWorkbench.patchFilters({ [control.filterKey]: v })}
            ariaLabel={label}
          />
        )}
        {control.kind === 'boolean' && (
          <label className={styles.toggleSwitch}>
            <input
              type="checkbox"
              checked={filters[control.filterKey] === control.activeValue}
              onChange={(e) => speciesCatalogWorkbench.patchFilters({
                [control.filterKey]: (e.target as HTMLInputElement).checked ? control.activeValue : null,
              })}
            />
            <span className={styles.toggleTrack} />
          </label>
        )}
      </div>
    </div>
  )
}
