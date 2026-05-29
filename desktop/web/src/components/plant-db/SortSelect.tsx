import { t } from '../../i18n';
import { locale } from '../../app/settings/state';
import { speciesCatalogWorkbench } from '../../app/plant-browser';
import type { Sort } from '../../types/species';
import styles from './PlantDb.module.css';

const SORT_OPTIONS: { value: Sort; labelKey: string }[] = [
  { value: 'Relevance', labelKey: 'plantDb.sortRelevance' },
  { value: 'Name', labelKey: 'plantDb.sortName' },
  { value: 'Family', labelKey: 'plantDb.sortFamily' },
  { value: 'Height', labelKey: 'plantDb.sortHeight' },
  { value: 'Hardiness', labelKey: 'plantDb.sortHardiness' },
  { value: 'GrowthRate', labelKey: 'plantDb.sortGrowthRate' },
];

export function SortSelect() {
  void locale.value;
  const intent = speciesCatalogWorkbench.intent.value;
  const showBestMatch =
    intent.sort === 'Relevance' || speciesCatalogWorkbench.isActiveSearchText(intent.text);
  const options = showBestMatch
    ? SORT_OPTIONS
    : SORT_OPTIONS.filter((option) => option.value !== 'Relevance');

  return (
    <select
      className={styles.sortSelect}
      value={intent.sort}
      onChange={(e) => {
        speciesCatalogWorkbench.setSort(e.currentTarget.value as Sort);
      }}
      aria-label={t('plantDb.sort')}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {t('plantDb.sort')}: {t(opt.labelKey)}
        </option>
      ))}
    </select>
  );
}
