import { t } from '../../i18n';
import { speciesCatalogWorkbench } from '../../app/plant-browser';
import styles from './PlantDb.module.css';

export function SearchBar() {
  const intent = speciesCatalogWorkbench.intent.value;
  const results = speciesCatalogWorkbench.results.value;
  const text = intent.text;
  const count = results.totalEstimate;
  const searching = speciesCatalogWorkbench.isSearchLoading(results.status);

  return (
    <div className={styles.searchWrap}>
      <div className={styles.searchInputWrap}>
        <input
          type="search"
          className={styles.searchInput}
          value={text}
          onInput={(e) => {
            speciesCatalogWorkbench.setSearchText(e.currentTarget.value);
          }}
          placeholder={t('plantDb.searchPlaceholder')}
          aria-label={t('plantDb.searchPlaceholder')}
        />
        {text.length > 0 && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => {
              speciesCatalogWorkbench.clearSearchText();
            }}
            aria-label={t('plantDb.clearSearch')}
          >
            ×
          </button>
        )}
      </div>
      {!searching && count > 0 && (
        <span
          className={styles.resultCount}
          aria-live="polite"
          aria-atomic="true"
        >
          {t('plantDb.resultsCount', { count })}
        </span>
      )}
    </div>
  );
}
