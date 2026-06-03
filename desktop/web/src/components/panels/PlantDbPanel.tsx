import { useEffect } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import { locale } from '../../app/settings/state'
import { speciesCatalogWorkbench } from '../../app/plant-browser'
import { SearchBar } from '../plant-db/SearchBar'
import { FilterStrip } from '../plant-db/FilterStrip'
import { ActiveChips } from '../plant-db/ActiveChips'
import { ResultsList } from '../plant-db/ResultsList'
import { ViewModeToggle } from '../plant-db/ViewModeToggle'
import { MoreFiltersPanel } from '../plant-db/MoreFiltersPanel'
import { PlantDetailCard } from '../plant-detail/PlantDetailCard'
import plantDetailStyles from '../plant-detail/PlantDetail.module.css'
import styles from '../plant-db/PlantDb.module.css'

export function PlantDbPanel() {
  const selected = speciesCatalogWorkbench.selectedCanonicalName.value
  const moreFiltersOpen = useSignal(false)

  useEffect(() => {
    const disposeController = speciesCatalogWorkbench.mount()
    speciesCatalogWorkbench.ensureInitialSearch()
    return disposeController
  }, [])

  // Reload favorites/recent when locale changes (names are locale-dependent)
  useSignalEffect(() => {
    void locale.value
    void speciesCatalogWorkbench.reloadSidebarLists()
  })

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
          <ViewModeToggle />
        </div>

        <div className={styles.filterRegion}>
          {/* Always-visible filter rows */}
          <FilterStrip onMoreFilters={() => { moreFiltersOpen.value = !moreFiltersOpen.value }} />

          {/* Active filter chips */}
          <ActiveChips />
        </div>

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
