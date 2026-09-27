import type { ComponentChildren } from 'preact'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { speciesCatalogWorkbench } from '../../app/plant-browser'
import { currentCanvasToolCommandSurface } from '../../canvas/session'
import {
  beginPlantStampFromSpecies,
  writePlantStampDragData,
} from '../../canvas/plant-stamp-source'
import type { PlantSymbolId } from '../../canvas/runtime/scene'
import type { SpeciesListItem } from '../../types/species'
import { PlantSymbolGlyph } from '../canvas/PlantSymbolGlyph'
import { ControlIcon } from '../shared/ControlIcon'
import row from '../shared/species-row.module.css'
import { secondaryCommonNameForDisplay } from './common-name-display'
import type { CatalogDesignSpecies } from './design-species'
import styles from './PlantDb.module.css'

/** A catalog species without plants in the Design takes the symbol of its growth habit. */
const HABIT_SYMBOLS: Readonly<Record<string, PlantSymbolId>> = {
  Tree: 'canopy',
  Shrub: 'shrub',
  Herbaceous: 'herb',
  Climber: 'climber',
}

interface Props {
  plant: SpeciesListItem
  /** The species' plants in the open Design, when it has some: glyph, colour and code. */
  inDesign?: CatalogDesignSpecies
  /** Renders a name with the search matches marked. */
  highlight?: (text: string) => ComponentChildren
}

/**
 * One catalog species row: glyph · common name over italic scientific name over a quiet
 * facts line · code when the species is in this Design · Place · favourite star. The row
 * body opens details and drags onto the map.
 */
export function PlantRow({ plant, inDesign, highlight }: Props) {
  const session = currentCanvasToolCommandSurface.value
  const show = highlight ?? ((text: string) => text)
  const name = plant.common_name || plant.canonical_name
  const showMatchedCommonName = speciesCatalogWorkbench.isActiveSearchText(speciesCatalogWorkbench.intent.value.text)
  const matchedName = showMatchedCommonName ? secondaryCommonNameForDisplay(plant, true) : null
  const facts = catalogFacts(plant, locale.value)

  const handleDragStart = (e: DragEvent) => {
    writePlantStampDragData(e.dataTransfer, plant)

    const preview = document.createElement('div')
    preview.textContent = name
    Object.assign(preview.style, {
      position: 'absolute', top: '-1000px', left: '-1000px',
      padding: '3px 8px', background: 'var(--color-accent, #A06B1F)',
      color: '#fff', fontSize: '11px', fontFamily: 'Inter, sans-serif',
      borderRadius: '3px', whiteSpace: 'nowrap', pointerEvents: 'none',
    })
    document.body.appendChild(preview)
    e.dataTransfer?.setDragImage?.(preview, -12, -12)
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => preview.remove())
    else preview.remove()
  }

  return (
    <div
      className={`${row.row} ${styles.catalogRow}`}
      role="listitem"
      draggable={true}
      onDragStart={handleDragStart}
      data-testid="catalog-species-row"
    >
      <button
        type="button"
        className={`${row.main} ${styles.catalogRowMain}`}
        aria-label={t('plantDb.details', { name })}
        onClick={() => speciesCatalogWorkbench.selectSpecies(plant.canonical_name)}
      >
        <span className={`${row.glyph} ${inDesign ? '' : styles.catalogGlyph}`} style={inDesign ? { color: inDesign.color } : undefined} aria-hidden="true">
          <PlantSymbolGlyph symbol={inDesign?.symbol ?? HABIT_SYMBOLS[plant.habit ?? ''] ?? 'round'} size={22} />
        </span>
        <span className={styles.rowNames}>
          <strong className={plant.is_name_fallback ? styles.nameFallback : undefined}>
            {show(name)}
            {matchedName && <span className={styles.matchedName}> · {show(matchedName)}</span>}
          </strong>
          {name !== plant.canonical_name && <em lang="la">{show(plant.canonical_name)}</em>}
          {facts && <span className={styles.facts}>{facts}</span>}
        </span>
        <span className={row.code}>{inDesign?.code ?? ''}</span>
      </button>
      <button
        type="button"
        className={styles.placeBtn}
        onClick={() => beginPlantStampFromSpecies(plant, session)}
        aria-label={t('plantDb.placeSpecies', { name })}
      >
        {t('plantDb.place')}
      </button>
      <button
        type="button"
        className={`${styles.favBtn} ${plant.is_favorite ? styles.favBtnActive : ''}`}
        onClick={() => { void speciesCatalogWorkbench.toggleFavorite(plant.canonical_name) }}
        aria-label={plant.is_favorite
          ? t('plantDb.removeFavoriteNamed', { name })
          : t('plantDb.addFavoriteNamed', { name })}
        aria-pressed={plant.is_favorite}
      >
        <ControlIcon name={plant.is_favorite ? 'star' : 'star-outline'} />
      </button>
    </div>
  )
}

/** "Tree · 8 m · USDA 5–9 · Edible 4/5": form, height, hardiness and edibility when known. */
export function catalogFacts(plant: SpeciesListItem, currentLocale: string): string {
  const facts: string[] = []
  if (plant.habit) facts.push(t(`filters.habit_${plant.habit}`, plant.habit))
  if (plant.height_max_m !== null) {
    const height = new Intl.NumberFormat(currentLocale, { maximumFractionDigits: 1 }).format(plant.height_max_m)
    facts.push(t('plantDb.factHeight', { height }))
  }
  const min = plant.hardiness_zone_min
  const max = plant.hardiness_zone_max
  if (min !== null) {
    facts.push(t('plantDb.factHardiness', { zones: max !== null && max !== min ? `${min}–${max}` : `${min}` }))
  }
  if (plant.edibility_rating !== null && plant.edibility_rating > 0) {
    facts.push(t('plantDb.factEdible', { rating: plant.edibility_rating }))
  }
  return facts.join(' · ')
}
