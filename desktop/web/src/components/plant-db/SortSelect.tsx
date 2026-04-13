import { t } from '../../i18n';
import { locale } from '../../app/settings/state';
import { sortField } from '../../app/plant-browser';
import type { Sort } from '../../types/species';
import styles from './PlantDb.module.css';

const SORT_OPTIONS: { value: Sort; labelKey: string }[] = [
  { value: 'Name', labelKey: 'plantDb.sortName' },
  { value: 'Family', labelKey: 'plantDb.sortFamily' },
  { value: 'Height', labelKey: 'plantDb.sortHeight' },
  { value: 'Hardiness', labelKey: 'plantDb.sortHardiness' },
  { value: 'GrowthRate', labelKey: 'plantDb.sortGrowthRate' },
  { value: 'Relevance', labelKey: 'plantDb.sortRelevance' },
];

export function SortSelect() {
  void locale.value;

  return (
    <select
      className={styles.sortSelect}
      value={sortField.value}
      onChange={(e) => {
        sortField.value = e.currentTarget.value as Sort;
      }}
      aria-label={t('plantDb.sort')}
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {t('plantDb.sort')}: {t(opt.labelKey)}
        </option>
      ))}
    </select>
  );
}
