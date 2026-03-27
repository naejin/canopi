import { t } from '../../i18n'
import { locale } from '../../state/app'
import { toggleFavoriteAction, selectedCanonicalName } from '../../state/plant-db'
import { plantStampSpecies } from '../../state/canvas'
import { canvasEngine } from '../../canvas/engine'
import type { SpeciesListItem } from '../../types/species'
import styles from './PlantDb.module.css'

interface Props {
  plant: SpeciesListItem
}

export function PlantRow({ plant }: Props) {
  void locale.value

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer!.setData('text/plain', JSON.stringify({
      canonical_name: plant.canonical_name,
      common_name: plant.common_name,
      stratum: plant.stratum,
      width_max_m: plant.width_max_m,
    }))
    e.dataTransfer!.effectAllowed = 'copy'

    const preview = document.createElement('div')
    preview.textContent = plant.common_name || plant.canonical_name
    Object.assign(preview.style, {
      position: 'absolute', top: '-1000px', left: '-1000px',
      padding: '3px 8px', background: 'var(--color-accent, #A06B1F)',
      color: '#fff', fontSize: '11px', fontFamily: 'Inter, sans-serif',
      borderRadius: '3px', whiteSpace: 'nowrap', pointerEvents: 'none',
    })
    document.body.appendChild(preview)
    e.dataTransfer!.setDragImage(preview, -12, -12)
    requestAnimationFrame(() => preview.remove())
  }

  const handlePlace = (e: MouseEvent) => {
    e.stopPropagation()
    plantStampSpecies.value = {
      canonical_name: plant.canonical_name,
      common_name: plant.common_name,
      stratum: plant.stratum,
      width_max_m: plant.width_max_m,
    }
    canvasEngine?.setActiveTool('plant-stamp')
  }

  const handleRowClick = () => {
    selectedCanonicalName.value = plant.canonical_name
  }

  const handleRowKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectedCanonicalName.value = plant.canonical_name
    }
  }

  const hardiness = plant.hardiness_zone_min !== null
    ? plant.hardiness_zone_max !== null && plant.hardiness_zone_max !== plant.hardiness_zone_min
      ? `Z${plant.hardiness_zone_min}–${plant.hardiness_zone_max}`
      : `Z${plant.hardiness_zone_min}`
    : null

  return (
    <div
      className={styles.plantRow}
      draggable={true}
      onDragStart={handleDragStart}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
      tabIndex={0}
      role="listitem"
      aria-label={plant.canonical_name}
    >
      <div className={styles.plantRowContent}>
        <div className={styles.nameRow}>
          <span className={styles.botanicalName}>{plant.canonical_name}</span>
          {plant.common_name && (
            <span className={styles.commonName}>{plant.common_name}</span>
          )}
        </div>
        <div className={styles.tagRow}>
          {plant.family && <span className={styles.tag} style={{ color: 'var(--color-family)' }}>{plant.family}</span>}
          {hardiness && <span className={styles.tag} style={{ color: 'var(--color-hardiness)' }}>{hardiness}</span>}
          {plant.height_max_m !== null && <span className={styles.tag} style={{ color: 'var(--color-height)' }}>↕{plant.height_max_m}m</span>}
          {plant.stratum && <span className={styles.tag} style={{ color: 'var(--color-accent)' }}>{plant.stratum}</span>}
          {plant.edibility_rating !== null && plant.edibility_rating > 0 && (
            <span className={styles.tag} style={{ color: 'var(--color-edible)' }}>{t('plantDb.edible')} {plant.edibility_rating}/5</span>
          )}
        </div>
      </div>

      <div className={styles.rowActions}>
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
          onClick={(e: MouseEvent) => {
            e.stopPropagation()
            void toggleFavoriteAction(plant.canonical_name)
          }}
          aria-label={plant.is_favorite ? t('plantDb.removeFavorite') : t('plantDb.addFavorite')}
          aria-pressed={plant.is_favorite}
        >
          {plant.is_favorite ? '★' : '☆'}
        </button>
      </div>
    </div>
  )
}
