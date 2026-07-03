import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { speciesCatalogWorkbench } from '../../app/plant-browser'
import { currentCanvasToolCommandSurface } from '../../canvas/session'
import {
  beginPlantStampFromSpecies,
  writePlantStampDragData,
} from '../../canvas/plant-stamp-source'
import { STRATUM_I18N_KEY } from '../../types/constants'
import type { SpeciesListItem } from '../../types/species'
import { secondaryCommonNameForDisplay } from './common-name-display'
import styles from './PlantDb.module.css'

/** Format height to 1 decimal place max, dropping trailing .0 */
function fmtHeight(m: number): string {
  const rounded = Math.round(m * 10) / 10
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)
}

interface Props {
  plant: SpeciesListItem
}

export function PlantCard({ plant }: Props) {
  void locale.value
  const session = currentCanvasToolCommandSurface.value

  const handleDragStart = (e: DragEvent) => {
    writePlantStampDragData(e.dataTransfer, plant)
  }

  const handleClick = () => {
    speciesCatalogWorkbench.selectSpecies(plant.canonical_name)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      speciesCatalogWorkbench.selectSpecies(plant.canonical_name)
    }
  }

  const handlePlace = (e: MouseEvent) => {
    e.stopPropagation()
    beginPlantStampFromSpecies(plant, session)
  }

  const handleFavClick = (e: MouseEvent) => {
    e.stopPropagation()
    void speciesCatalogWorkbench.toggleFavorite(plant.canonical_name)
  }

  const hardiness = plant.hardiness_zone_min !== null
    ? plant.hardiness_zone_max !== null && plant.hardiness_zone_max !== plant.hardiness_zone_min
      ? `Z${plant.hardiness_zone_min}–${plant.hardiness_zone_max}`
      : `Z${plant.hardiness_zone_min}`
    : null
  const showMatchedCommonName = speciesCatalogWorkbench.isActiveSearchText(speciesCatalogWorkbench.intent.value.text)
  const secondaryCommonName = secondaryCommonNameForDisplay(plant, showMatchedCommonName)

  return (
    <div
      className={styles.plantCard}
      draggable={true}
      onDragStart={handleDragStart}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="listitem"
      aria-label={plant.canonical_name}
    >
      {/* Names */}
      <div className={styles.cardNames}>
        {plant.common_name ? (
          <>
            <span className={plant.is_name_fallback ? styles.cardNameFallback : styles.cardName}>
              {plant.common_name}
            </span>
            {secondaryCommonName && (
              <span className={styles.cardNameSecondary}>{secondaryCommonName}</span>
            )}
          </>
        ) : null}
        <span className={styles.cardBotanical}>{plant.canonical_name}</span>
      </div>

      {/* Tags */}
      <div className={styles.cardTags}>
        {plant.family && <span className={styles.tag} style={{ color: 'var(--color-family)' }}>{plant.family}</span>}
        {hardiness && <span className={styles.tag} style={{ color: 'var(--color-hardiness)' }}>{hardiness}</span>}
        {plant.height_max_m !== null && <span className={styles.tag} style={{ color: 'var(--color-height)' }}>↕{fmtHeight(plant.height_max_m)}m</span>}
        {plant.stratum && (() => {
          const key = STRATUM_I18N_KEY[plant.stratum]
          return <span className={styles.tag} style={{ color: 'var(--color-accent)' }}>{key ? t(key) : plant.stratum}</span>
        })()}
        {plant.edibility_rating !== null && plant.edibility_rating > 0 && (
          <span className={styles.tag} style={{ color: 'var(--color-edible)' }}>{t('plantDb.edible')} {plant.edibility_rating}/5</span>
        )}
      </div>

      {/* Actions */}
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.placeBtn}
          onClick={handlePlace}
          aria-label={t('plantDb.setAsStamp')}
          title={t('plantDb.setAsStamp')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 2v8M2 6h8" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.favBtn} ${plant.is_favorite ? styles.favBtnActive : ''}`}
          onClick={handleFavClick}
          aria-label={plant.is_favorite ? t('plantDb.removeFavorite') : t('plantDb.addFavorite')}
          aria-pressed={plant.is_favorite}
          title={plant.is_favorite ? t('plantDb.removeFavorite') : t('plantDb.addFavorite')}
        >
          {plant.is_favorite ? '★' : '☆'}
        </button>
      </div>
    </div>
  )
}
