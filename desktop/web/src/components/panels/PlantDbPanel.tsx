import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { t } from '../../i18n';
import { locale } from '../../state/app';
import {
  loadSidebarLists,
  selectedCanonicalName,
  searchResults,
  isSearching,
  retrySearch,
} from '../../state/plant-db';
import { SearchBar } from '../plant-db/SearchBar';
import { FilterSidebar } from '../plant-db/FilterSidebar';
import { ResultsList } from '../plant-db/ResultsList';
import { SortSelect } from '../plant-db/SortSelect';
import { ViewModeToggle } from '../plant-db/ViewModeToggle';
import { PlantDetailCard } from '../plant-detail/PlantDetailCard';
import plantDetailStyles from '../plant-detail/PlantDetail.module.css';
import styles from '../plant-db/PlantDb.module.css';

export function PlantDbPanel() {
  void locale.value;
  const sidebarOpen = useSignal(true);
  const selected = selectedCanonicalName.value;

  useEffect(() => {
    void loadSidebarLists();
    // Trigger a fresh search when the panel mounts — by this point Tauri IPC
    // is ready (the user clicked the leaf icon after the app loaded).
    if (searchResults.value.length === 0 && !isSearching.value) {
      retrySearch();
    }
  }, []);

  return (
    <div className={styles.panel}>
      {/* Filter sidebar — hidden when detail view is open */}
      {selected === null && (
        <aside
          className={`${styles.sidebar} ${sidebarOpen.value ? '' : styles.sidebarCollapsed}`}
          aria-label={t('plantDb.filters')}
          aria-hidden={!sidebarOpen.value}
        >
          {sidebarOpen.value && <FilterSidebar />}
        </aside>
      )}

      {/* Main content — always mounted, visibility toggled via CSS to preserve Virtualizer state */}
      <div
        className={`${styles.main} ${selected !== null ? plantDetailStyles.detailHidden : ''}`}
        aria-hidden={selected !== null}
      >
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.sidebarToggle}
            onClick={() => {
              sidebarOpen.value = !sidebarOpen.value;
            }}
            aria-label={t('plantDb.filters')}
            aria-expanded={sidebarOpen.value}
            title={t('plantDb.filters')}
          >
            ⊟
          </button>

          <SearchBar />

          <div className={styles.toolbarRight}>
            <SortSelect />
            <ViewModeToggle />
          </div>
        </div>

        {/* Results */}
        <ResultsList />
      </div>

      {/* Detail card — mounted only when a plant is selected */}
      {selected !== null && (
        <div className={plantDetailStyles.detailVisible}>
          <PlantDetailCard canonicalName={selected} />
        </div>
      )}
    </div>
  );
}
