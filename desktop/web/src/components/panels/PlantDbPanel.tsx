import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import {
  loadSidebarLists,
  selectedCanonicalName,
  searchResults,
  isSearching,
  retrySearch,
} from '../../state/plant-db'
import { SearchBar } from '../plant-db/SearchBar'
import { FilterSidebar } from '../plant-db/FilterSidebar'
import { ResultsList } from '../plant-db/ResultsList'
import { PlantDetailCard } from '../plant-detail/PlantDetailCard'
import plantDetailStyles from '../plant-detail/PlantDetail.module.css'
import styles from '../plant-db/PlantDb.module.css'

export function PlantDbPanel() {
  void locale.value
  const filtersOpen = useSignal(false)
  const selected = selectedCanonicalName.value

  useEffect(() => {
    void loadSidebarLists()
    if (searchResults.value.length === 0 && !isSearching.value) {
      retrySearch()
    }
  }, [])

  return (
    <div className={styles.panel}>
      {/* Search + filters + results */}
      <div
        className={`${styles.main} ${selected !== null ? plantDetailStyles.detailHidden : ''}`}
        aria-hidden={selected !== null}
      >
        {/* Search header */}
        <div className={styles.searchHeader}>
          <SearchBar />
          <button
            type="button"
            className={`${styles.filterToggle} ${filtersOpen.value ? styles.filterToggleActive : ''}`}
            onClick={() => { filtersOpen.value = !filtersOpen.value }}
            aria-label={t('plantDb.filters')}
            aria-expanded={filtersOpen.value}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M2 3h12M4 7h8M6 11h4" />
            </svg>
          </button>
        </div>

        {/* Collapsible filters — pushes results down when open */}
        {filtersOpen.value && (
          <div className={styles.filterDrawer}>
            <FilterSidebar />
          </div>
        )}

        {/* Results */}
        <ResultsList />
      </div>

      {/* Detail card */}
      {selected !== null && (
        <div className={plantDetailStyles.detailVisible}>
          <PlantDetailCard canonicalName={selected} />
        </div>
      )}
    </div>
  )
}
