import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { speciesCatalogWorkbench } from '../../app/plant-browser'
import { CatalogBrowser } from '../plant-db/CatalogBrowser'
import { MoreFiltersPanel } from '../plant-db/MoreFiltersPanel'
import { useFavoriteSpeciesDetailNavigation } from '../plant-db/favorite-species-presentation'
import { interfaceLanguageName } from '../plant-db/language-name'
import { PlantDetailCard } from '../plant-detail/PlantDetailCard'
import { DockPanelHeader } from '../shared/DockPanelHeader'
import plantDetailStyles from '../plant-detail/PlantDetail.module.css'
import styles from '../plant-db/PlantDb.module.css'

/** The Desktop Plant catalog (Ctrl 3): the shared catalog list, More filters and species detail. */
export function PlantDbPanel() {
  const selected = speciesCatalogWorkbench.selectedCanonicalName.value
  const moreFiltersOpen = useSignal(false)
  const mainRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  // Back returns focus to the row that opened the detail.
  useFavoriteSpeciesDetailNavigation({ canonicalName: selected, detailRef, mainRef })

  useEffect(() => speciesCatalogWorkbench.mount('catalog'), [])

  return (
    <section className={styles.panel} aria-label={t('plantDb.title')}>
      <div
        ref={mainRef}
        className={styles.main}
        hidden={selected !== null}
        aria-hidden={selected !== null}
        inert={selected !== null}
      >
        <DockPanelHeader title={t('plantDb.title')} />
        <CatalogBrowser
          onMoreFilters={() => { moreFiltersOpen.value = !moreFiltersOpen.value }}
          searchScope={t('plantDb.searchScopeDesktop', { language: interfaceLanguageName(locale.value) })}
        />
        <MoreFiltersPanel
          open={moreFiltersOpen.value}
          onClose={() => { moreFiltersOpen.value = false }}
        />
      </div>

      {selected !== null && (
        <div ref={detailRef} className={plantDetailStyles.detailVisible}>
          <PlantDetailCard canonicalName={selected} />
        </div>
      )}
    </section>
  )
}
