import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { locale } from '../../state/app'
import {
  loadSidebarLists,
  selectedCanonicalName,
  searchResults,
  isSearching,
  retrySearch,
} from '../../state/plant-db'
import { SearchBar } from '../plant-db/SearchBar'
import { FilterStrip } from '../plant-db/FilterStrip'
import { ActiveChips } from '../plant-db/ActiveChips'
import { ResultsList } from '../plant-db/ResultsList'
import { MoreFiltersPanel } from '../plant-db/MoreFiltersPanel'
import { PlantDetailCard } from '../plant-detail/PlantDetailCard'
import plantDetailStyles from '../plant-detail/PlantDetail.module.css'
import styles from '../plant-db/PlantDb.module.css'

export function PlantDbPanel() {
  void locale.value
  const selected = selectedCanonicalName.value
  const moreFiltersOpen = useSignal(false)

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
        </div>

        {/* Always-visible filter strip */}
        <FilterStrip onMoreFilters={() => { moreFiltersOpen.value = !moreFiltersOpen.value }} />

        {/* Active filter chips */}
        <ActiveChips />

        {/* Results */}
        <ResultsList />

        {/* More Filters overlay */}
        <MoreFiltersPanel
          open={moreFiltersOpen.value}
          onClose={() => { moreFiltersOpen.value = false }}
        />
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
