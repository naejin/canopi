import { useEffect } from 'preact/hooks';
import { t } from '../../i18n';
import { locale } from '../../state/app';
import {
  activeFilters,
  filterOptions,
  hasActiveFilters,
  loadFilterOptions,
  clearFilters,
} from '../../state/plant-db';
import type { SpeciesFilter } from '../../types/species';
import { FilterSection } from './FilterSection';
import styles from './PlantDb.module.css';

function toggleArrayValue(arr: string[] | null, val: string): string[] | null {
  if (arr === null) return [val];
  if (arr.includes(val)) {
    const next = arr.filter((v) => v !== val);
    return next.length === 0 ? null : next;
  }
  return [...arr, val];
}

export function FilterSidebar() {
  void locale.value;
  const opts = filterOptions.value;
  const filters = activeFilters.value;
  const showClear = hasActiveFilters.value;

  useEffect(() => {
    void loadFilterOptions();
  }, []);

  function update(patch: Partial<SpeciesFilter>): void {
    activeFilters.value = { ...activeFilters.value, ...patch };
  }

  return (
    <>
      <div className={styles.filterHeader}>
        <span className={styles.filterTitle}>{t('plantDb.filters')}</span>
        {showClear && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={clearFilters}
            aria-label={t('plantDb.clearFilters')}
          >
            {t('plantDb.clearFilters')}
          </button>
        )}
      </div>

      <div className={styles.filterScroll}>
        <FilterSection
          title={t('plantDb.filterHardiness')}
          type="range"
          rangeMin={filters.hardiness_min}
          rangeMax={filters.hardiness_max}
          rangeAbsMin={opts?.hardiness_range[0] ?? 1}
          rangeAbsMax={opts?.hardiness_range[1] ?? 13}
          onRangeMin={(v) => update({ hardiness_min: v })}
          onRangeMax={(v) => update({ hardiness_max: v })}
        />

        <FilterSection
          title={t('plantDb.filterSun')}
          type="checkboxes"
          options={
            opts?.sun_tolerances.map((s) => ({ value: s, label: s })) ?? []
          }
          selected={filters.sun_tolerances ?? []}
          onToggleOption={(v) =>
            update({ sun_tolerances: toggleArrayValue(filters.sun_tolerances, v) })
          }
        />

        <FilterSection
          title={t('plantDb.filterGrowthRate')}
          type="checkboxes"
          options={
            opts?.growth_rates.map((g) => ({ value: g, label: g })) ?? []
          }
          selected={filters.growth_rate ?? []}
          onToggleOption={(v) =>
            update({ growth_rate: toggleArrayValue(filters.growth_rate, v) })
          }
        />

        <FilterSection
          title={t('plantDb.filterLifeCycle')}
          type="checkboxes"
          options={
            opts?.life_cycles.map((l) => ({ value: l, label: l })) ?? []
          }
          selected={filters.life_cycle ?? []}
          onToggleOption={(v) =>
            update({ life_cycle: toggleArrayValue(filters.life_cycle, v) })
          }
        />

        <FilterSection
          title={t('plantDb.filterStratum')}
          type="checkboxes"
          options={
            opts?.strata.map((s) => ({ value: s, label: s })) ?? []
          }
          selected={filters.stratum ?? []}
          onToggleOption={(v) =>
            update({ stratum: toggleArrayValue(filters.stratum, v) })
          }
        />

        <FilterSection
          title={t('plantDb.filterSoilType')}
          type="checkboxes"
          options={
            opts?.soil_types.map((s) => ({ value: s, label: s })) ?? []
          }
          selected={filters.soil_types ?? []}
          onToggleOption={(v) =>
            update({ soil_types: toggleArrayValue(filters.soil_types, v) })
          }
        />

        <FilterSection
          title={t('plantDb.filterNitrogenFixer')}
          type="toggle"
          toggleValue={filters.nitrogen_fixer}
          toggleLabel={t('plantDb.filterNitrogenFixer')}
          onToggle={(v) => update({ nitrogen_fixer: v })}
        />

        <FilterSection
          title={t('plantDb.filterEdible')}
          type="toggle"
          toggleValue={filters.edible}
          toggleLabel={t('plantDb.filterEdible')}
          onToggle={(v) => update({ edible: v })}
        />
      </div>
    </>
  );
}
