import { t } from '../../i18n'
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
  variant?: 'catalog' | 'favorites'
}

export function PlantRow({ plant, variant = 'catalog' }: Props) {
  const session = currentCanvasToolCommandSurface.value

  const handleDragStart = (e: DragEvent) => {
    writePlantStampDragData(e.dataTransfer, plant)

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
    beginPlantStampFromSpecies(plant, session)
  }

  const handleRowClick = () => {
    speciesCatalogWorkbench.selectSpecies(plant.canonical_name)
  }

  const handleRowKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      speciesCatalogWorkbench.selectSpecies(plant.canonical_name)
    }
  }

  const hardiness = plant.hardiness_zone_min !== null
    ? plant.hardiness_zone_max !== null && plant.hardiness_zone_max !== plant.hardiness_zone_min
      ? `Z${plant.hardiness_zone_min}–${plant.hardiness_zone_max}`
      : `Z${plant.hardiness_zone_min}`
    : null
  const metadataTags = variant === 'favorites'
    ? favoriteMetadataTags(plant)
    : catalogMetadataTags(plant, hardiness)
  const showMatchedCommonName = variant === 'catalog'
    && speciesCatalogWorkbench.isActiveSearchText(speciesCatalogWorkbench.intent.value.text)
  const secondaryCommonName = secondaryCommonNameForDisplay(plant, showMatchedCommonName)

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
          {plant.common_name ? (
            <>
              <span className={plant.is_name_fallback ? styles.commonNameFallback : styles.commonName}>
                {plant.common_name}
                {secondaryCommonName && <span className={styles.secondaryName}> · {secondaryCommonName}</span>}
              </span>
              <span className={styles.botanicalName}>{plant.canonical_name}</span>
            </>
          ) : (
            <span className={styles.botanicalName}>{plant.canonical_name}</span>
          )}
        </div>
        <div className={styles.tagRow}>
          {metadataTags.map((tag) => (
            <span key={tag.label} className={styles.tag} style={{ color: tag.color }}>{tag.label}</span>
          ))}
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
            void speciesCatalogWorkbench.toggleFavorite(plant.canonical_name)
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

interface PlantRowMetadataTag {
  readonly label: string
  readonly color: string
}

function catalogMetadataTags(plant: SpeciesListItem, hardiness: string | null): PlantRowMetadataTag[] {
  const tags: PlantRowMetadataTag[] = []
  if (plant.family) tags.push({ label: plant.family, color: 'var(--color-family)' })
  if (hardiness) tags.push({ label: hardiness, color: 'var(--color-hardiness)' })
  if (plant.height_max_m !== null) {
    tags.push({ label: `↕${fmtHeight(plant.height_max_m)}m`, color: 'var(--color-height)' })
  }
  if (plant.stratum) {
    const key = STRATUM_I18N_KEY[plant.stratum]
    tags.push({ label: key ? t(key) : plant.stratum, color: 'var(--color-accent)' })
  }
  if (plant.edibility_rating !== null && plant.edibility_rating > 0) {
    tags.push({
      label: `${t('plantDb.edible')} ${plant.edibility_rating}/5`,
      color: 'var(--color-edible)',
    })
  }
  return tags
}

function favoriteMetadataTags(plant: SpeciesListItem): PlantRowMetadataTag[] {
  return [
    ...plant.climate_zones.map((zone) => ({
      label: translateFilterValue('climateZone_', zone),
      color: 'var(--color-hardiness)',
    })),
    ...plant.life_cycles.map((cycle) => ({
      label: translateFilterValue('lifeCycle_', cycle),
      color: 'var(--color-accent)',
    })),
  ]
}

function translateFilterValue(prefix: string, value: string): string {
  const key = `filters.${prefix}${value}`
  const translated = t(key)
  return translated === key ? value : translated
}
