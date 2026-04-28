import { t } from '../../i18n';
import { locale } from '../../app/settings/state';
import { isPlantSearchLoading, plantSearchSession } from '../../app/plant-browser';
import styles from './PlantDb.module.css';

export function SearchBar() {
  // Subscribe to locale for re-render on language change
  void locale.value;

  const intent = plantSearchSession.intent.value;
  const results = plantSearchSession.results.value;
  const text = intent.text;
  const count = results.totalEstimate;
  const searching = isPlantSearchLoading(results.status);

  return (
    <div className={styles.searchWrap}>
      <div className={styles.searchInputWrap}>
        <input
          type="search"
          className={styles.searchInput}
          value={text}
          onInput={(e) => {
            plantSearchSession.setText(e.currentTarget.value);
          }}
          placeholder={t('plantDb.searchPlaceholder')}
          aria-label={t('plantDb.searchPlaceholder')}
        />
        {text.length > 0 && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => {
              plantSearchSession.setText('');
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
