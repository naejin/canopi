import { t } from '../../i18n';
import { locale } from '../../state/app';
import { searchText, totalEstimate, isSearching } from '../../state/plant-db';
import styles from './PlantDb.module.css';

export function SearchBar() {
  // Subscribe to locale for re-render on language change
  void locale.value;

  const text = searchText.value;
  const count = totalEstimate.value;
  const searching = isSearching.value;

  return (
    <div className={styles.searchWrap}>
      <input
        type="search"
        className={styles.searchInput}
        value={text}
        onInput={(e) => {
          searchText.value = e.currentTarget.value;
        }}
        placeholder={t('plantDb.searchPlaceholder')}
        aria-label={t('plantDb.searchPlaceholder')}
      />
      {text.length > 0 && (
        <button
          type="button"
          className={styles.searchClear}
          onClick={() => {
            searchText.value = '';
          }}
          aria-label={t('plantDb.clearSearch')}
        >
          ×
        </button>
      )}
      {!searching && (
        <span
          className={`${styles.resultCount} ${text.length > 0 ? styles.resultCountShifted : ''}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {count > 0
            ? t('plantDb.resultsCount', { count })
            : ''}
        </span>
      )}
    </div>
  );
}
