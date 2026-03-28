import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { favoriteNames, selectedCanonicalName } from '../../state/plant-db'
import { getFavorites } from '../../ipc/favorites'
import { PlantRow } from '../plant-db/PlantRow'
import { PlantDetailCard } from '../plant-detail/PlantDetailCard'
import plantDetailStyles from '../plant-detail/PlantDetail.module.css'
import type { SpeciesListItem } from '../../types/species'
import styles from './FavoritesPanel.module.css'

export function FavoritesPanel() {
  const items = useSignal<SpeciesListItem[]>([])
  const loading = useSignal(true)

  // Read reactive dependencies before the effect so subscriptions are tracked
  const favCount = favoriteNames.value.length
  const lang = locale.value
  const selected = selectedCanonicalName.value

  useEffect(() => {
    loading.value = true
    getFavorites(lang)
      .then((result) => {
        items.value = result
        loading.value = false
      })
      .catch(() => {
        loading.value = false
      })
  }, [favCount, lang])

  const count = items.value.length
  const isLoading = loading.value

  return (
    <div className={styles.panel}>
      {/* Search + list view */}
      <div
        className={`${styles.main} ${selected !== null ? plantDetailStyles.detailHidden : ''}`}
        aria-hidden={selected !== null}
      >
        {/* Header — always visible */}
        <div className={styles.header}>
          <span className={styles.title}>{t('nav.favorites')}</span>
          {count > 0 && (
            <span className={styles.count}>{count}</span>
          )}
        </div>

        {/* Content area */}
        {isLoading ? (
          <div className={styles.loading} aria-live="polite" aria-busy="true">
            {t('plantDb.loading')}
          </div>
        ) : count === 0 ? (
          <div className={styles.empty} aria-live="polite">
            <svg className={styles.emptyIcon} width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span className={styles.emptyTitle}>{t('favorites.empty')}</span>
            <span className={styles.emptyHint}>{t('favorites.emptyHint')}</span>
          </div>
        ) : (
          <div className={styles.list} role="list" aria-label={t('nav.favorites')}>
            {items.value.map((plant) => (
              <PlantRow key={plant.canonical_name} plant={plant} />
            ))}
          </div>
        )}
      </div>

      {/* Detail card — slides in when a row is clicked */}
      {selected !== null && (
        <div className={plantDetailStyles.detailVisible}>
          <PlantDetailCard canonicalName={selected} />
        </div>
      )}
    </div>
  )
}
