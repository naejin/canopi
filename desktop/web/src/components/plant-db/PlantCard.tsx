import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { toggleFavoriteAction, selectedCanonicalName } from '../../app/plant-browser'
import { currentCanvasSession } from '../../canvas/session'
import { plantStampSpecies } from '../../canvas/plant-tool-state'
import { STRATUM_I18N_KEY } from '../../types/constants'
import type { SpeciesListItem } from '../../types/species'
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
  const session = currentCanvasSession.value

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer!.setData('text/plain', JSON.stringify({
      canonical_name: plant.canonical_name,
      common_name: plant.common_name,
      stratum: plant.stratum,
      width_max_m: plant.width_max_m,
    }))
    e.dataTransfer!.effectAllowed = 'copy'
  }

  const handleClick = () => {
    selectedCanonicalName.value = plant.canonical_name
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectedCanonicalName.value = plant.canonical_name
    }
  }

  const handlePlace = (e: MouseEvent) => {
    e.stopPropagation()
    plantStampSpecies.value = {
      canonical_name: plant.canonical_name,
      common_name: plant.common_name,
      stratum: plant.stratum,
      width_max_m: plant.width_max_m,
    }
    session?.setTool('plant-stamp')
  }

  const handleFavClick = (e: MouseEvent) => {
    e.stopPropagation()
    void toggleFavoriteAction(plant.canonical_name)
  }

  const hardiness = plant.hardiness_zone_min !== null
    ? plant.hardiness_zone_max !== null && plant.hardiness_zone_max !== plant.hardiness_zone_min
      ? `Z${plant.hardiness_zone_min}–${plant.hardiness_zone_max}`
      : `Z${plant.hardiness_zone_min}`
    : null

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
            {plant.common_name_2 && (
              <span className={styles.cardNameSecondary}>{plant.common_name_2}</span>
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
