import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { speciesCatalogWorkbench } from '../app/plant-browser'
import { currentCanvasToolCommandSurface } from '../canvas/session'
import {
  beginPlantStampFromSpecies,
  writePlantStampDragData,
} from '../canvas/plant-stamp-source'
import type { SpeciesCatalogDetail, SpeciesCatalogDetailView } from '../app/plant-browser/workbench'
import { t } from '../i18n'
import { locale } from '../app/settings/state'
import type { SpeciesListItem } from '../types/species'
import { CatalogBrowser } from '../components/plant-db/CatalogBrowser'
import { interfaceLanguageName } from '../components/plant-db/language-name'
import {
  filterFavoriteSpecies,
  useFavoriteSpeciesDetailNavigation,
} from '../components/plant-db/favorite-species-presentation'
import { SpeciesKeyPanel } from '../components/panels/SpeciesKeyPanel'
import { DockPanelHeader } from '../components/shared/DockPanelHeader'
import { SurfaceSearch } from '../components/shared/SurfaceSearch'
import { FactsGrid, OtherNames } from '../components/species-detail/FactsGrid'
import type { SpeciesPhoto } from '../components/species-detail/photo-attribution'
import { PhotoViewer, usePhotoList } from '../components/species-detail/PhotoViewer'
import { formatList, joinRecorded, type SpeciesFact } from '../components/species-detail/species-facts'
import { SpeciesDetailLayout } from '../components/species-detail/SpeciesDetailLayout'
import detailStyles from '../components/species-detail/SpeciesDetail.module.css'
import styles from './WebSpeciesCatalogPanel.module.css'

interface WebSpeciesCatalogPanelProps {
  readonly mode: 'catalog' | 'favorites'
}

export function WebSpeciesCatalogPanel({ mode }: WebSpeciesCatalogPanelProps) {
  const [favoriteSearch, setFavoriteSearch] = useState('')
  const favoritesView = speciesCatalogWorkbench.favorites.value
  const sidebar = speciesCatalogWorkbench.sidebar.value
  const detailView = speciesCatalogWorkbench.detail.value
  const isCatalog = mode === 'catalog'
  const visibleItems = filterFavoriteSpecies(favoritesView.items, favoriteSearch)
  const title = isCatalog ? t('plantDb.title') : t('nav.favorites')

  const mainRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const showingDetail = detailView.canonicalName !== null
  useFavoriteSpeciesDetailNavigation({
    active: true,
    canonicalName: showingDetail ? detailView.canonicalName : null,
    detailRef,
    mainRef,
  })

  useEffect(() => speciesCatalogWorkbench.mount(mode), [mode])

  return (
    <section className={styles.panel} data-testid={`web-species-${mode}-panel`} data-mode={mode} aria-label={title}>
      <div ref={mainRef} className={styles.main} hidden={showingDetail} inert={showingDetail} data-favorites-main={!isCatalog || undefined}>
      <DockPanelHeader title={title} />
      {isCatalog ? (
        <CatalogBrowser searchScope={t('plantDb.searchScopeWeb', { language: interfaceLanguageName(locale.value) })} />
      ) : (
        <>
          <div className={styles.header}><SurfaceSearch value={favoriteSearch} onChange={setFavoriteSearch} label={t('favorites.search')} /></div>
          <div className={styles.list}>
            <h3 className={styles.sectionTitle}>{t('canvas.layers.plants')}</h3>
            <SpeciesList
              items={visibleItems}
              loading={favoritesView.loading}
              emptyLabel={t(favoriteSearch ? 'speciesKey.noResults' : 'plantDb.noFavorites')}
            />
            <h3 className={styles.sectionTitle}>{t('plantDb.recentlyViewed')}</h3>
            <div className={styles.recentList} role="list">
              {sidebar.recentlyViewed.length === 0 ? (
                <div className={styles.empty}>{t('plantDb.noRecentlyViewed')}</div>
              ) : (
                sidebar.recentlyViewed.map((item) => <SpeciesRow key={item.canonical_name} item={item} />)
              )}
            </div>
          </div>
        </>
      )}
      </div>
      {showingDetail && <div ref={detailRef} className={styles.fullDetail}>
        <WebSpeciesDetail view={detailView} />
      </div>}
    </section>
  )
}

function WebSpeciesDetail({ view }: { readonly view: SpeciesCatalogDetailView }) {
  const detail = view.detail
  const photos = useMemo<SpeciesPhoto[]>(() => detail?.image
    ? [{
        url: detail.image.url,
        source: detail.image.source,
        sourcePageUrl: detail.image.source_page_url,
        credit: detail.image.credit,
        license: detail.image.license,
      }]
    : [], [detail?.image])
  const photoModel = usePhotoList(photos)
  const [namesExpanded, setNamesExpanded] = useState(false)

  if (!view.canonicalName) return null

  const commonName = detail?.common_name?.trim() || null
  const englishName = view.englishName ?? null
  const title = commonName ?? englishName ?? view.canonicalName
  const favorite = speciesCatalogWorkbench.sidebar.value.favoriteNames.includes(view.canonicalName)
  const canonicalName = view.canonicalName

  return (
    <SpeciesDetailLayout
      identity={{ canonicalName, commonName, englishName, family: null, habitKey: detail?.habit ?? null }}
      favorite={favorite}
      onToggleFavorite={() => { void speciesCatalogWorkbench.toggleFavorite(canonicalName) }}
      onBack={() => speciesCatalogWorkbench.closeSpeciesDetail()}
      place={detail ? { canonical_name: detail.canonical_name, common_name: detail.common_name, stratum: null, width_max_m: null } : null}
    >
      {view.loading && <p className={detailStyles.status} aria-live="polite" aria-busy="true">{t('plantDetail.loading')}</p>}
      {view.error && <p className={detailStyles.statusError} role="alert">{view.error}</p>}
      {detail && (
        <>
          <PhotoViewer model={photoModel} name={title} linkSources={true} />
          <OtherNames
            names={detail.common_names.filter((name) => name !== title)}
            expanded={namesExpanded}
            onToggle={() => setNamesExpanded(!namesExpanded)}
          />
          <FactsGrid facts={webSpeciesFacts(detail, locale.value)} />
        </>
      )}
    </SpeciesDetailLayout>
  )
}

/** The Web catalog carries only form, life cycle and climate zone (see the species catalog guide). */
function webSpeciesFacts(detail: SpeciesCatalogDetail, currentLocale: string): SpeciesFact[] {
  const habit = detail.habit ? t(`filters.habit_${detail.habit}`, detail.habit) : null
  const lifeCycles = detail.life_cycles.map((value) => t(`filters.lifeCycle_${value}`, value))
  const zones = detail.climate_zones.map((value) => t(`filters.climateZone_${value}`, value))
  return [
    { id: 'habit', label: t('plantDetail.habit'), value: joinRecorded([habit, detail.growth_form]) },
    { id: 'lifeCycle', label: t('filters.lifecycle'), value: lifeCycles.length > 0 ? formatList(lifeCycles, currentLocale) : null },
    { id: 'climateZones', label: t('plantDetail.climateZones'), value: zones.length > 0 ? formatList(zones, currentLocale) : null },
  ]
}

function SpeciesList({
  items,
  loading,
  emptyLabel,
}: {
  readonly items: readonly SpeciesListItem[]
  readonly loading: boolean
  readonly emptyLabel: string
}) {
  if (loading && items.length === 0) {
    return <div className={styles.loading}>{t('plantDb.loading')}</div>
  }

  if (items.length === 0) {
    return <div className={styles.empty}>{emptyLabel}</div>
  }

  return (
    <div className={styles.list} role="list">
      {items.map((item) => <SpeciesRow key={item.canonical_name} item={item} />)}
    </div>
  )
}

/** A Favorites or Recently viewed row: names, Place, star and Details. */
function SpeciesRow({ item }: { readonly item: SpeciesListItem }) {
  const commandSurface = currentCanvasToolCommandSurface.value
  const commonName = item.common_name?.trim() ?? ''
  const displayName = commonName.length > 0 ? commonName : item.canonical_name
  const showCanonicalName = displayName !== item.canonical_name
  const handleDragStart = (event: DragEvent) => {
    writePlantStampDragData(event.dataTransfer, item)
    const preview = document.createElement('div')
    preview.textContent = item.common_name || item.canonical_name
    Object.assign(preview.style, {
      position: 'absolute',
      top: '-1000px',
      left: '-1000px',
      padding: '3px 8px',
      background: 'var(--color-accent, #A06B1F)',
      color: '#fff',
      fontSize: '11px',
      fontFamily: 'Inter, sans-serif',
      borderRadius: '3px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    })
    document.body.appendChild(preview)
    event.dataTransfer?.setDragImage?.(preview, -12, -12)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => preview.remove())
    } else {
      preview.remove()
    }
  }
  const handlePlace = (event: MouseEvent) => {
    event.stopPropagation()
    beginPlantStampFromSpecies(item, commandSurface)
  }

  return (
    <div
      className={styles.row}
      draggable={true}
      onDragStart={handleDragStart}
      role="listitem"
      data-favorite-row
      data-testid="web-species-row"
    >
      <span className={styles.nameBlock}>
        <span className={styles.nameLine} data-testid="web-species-name-line">
          <span className={styles.commonName}>{displayName}</span>
          {showCanonicalName && (
            <>
              <span className={styles.nameSeparator} aria-hidden="true">·</span>
              <span className={styles.botanicalName}>{item.canonical_name}</span>
            </>
          )}
        </span>
      </span>
      <span className={styles.rowActions}>
        <button
          type="button"
          className={styles.placeButton}
          aria-label={t('plantDb.placeSpecies', { name: item.common_name ?? item.canonical_name })}
          data-testid="web-species-place"
          onClick={handlePlace}
        >
          {t('plantDb.place')}
        </button>
        <button
          type="button"
          className={`${styles.favoriteButton} ${item.is_favorite ? styles.favoriteButtonActive : ''}`}
          aria-label={item.is_favorite ? t('plantDb.removeFavorite') : t('plantDb.addFavorite')}
          aria-pressed={item.is_favorite}
          onClick={(event) => {
            event.stopPropagation()
            void speciesCatalogWorkbench.toggleFavorite(item.canonical_name)
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            event.stopPropagation()
            void speciesCatalogWorkbench.toggleFavorite(item.canonical_name)
          }}
        >
          {item.is_favorite ? '★' : '☆'}
        </button>
        <button type="button" className={styles.favoriteButton} data-species-detail={item.canonical_name}
          aria-label={t('speciesKey.details', { name: displayName })}
          onClick={() => speciesCatalogWorkbench.selectSpecies(item.canonical_name)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
        </button>
      </span>
    </div>
  )
}

export function WebSpeciesKeyPanel() {
  const view = speciesCatalogWorkbench.detail.value
  return <SpeciesKeyPanel renderDetail={() => <div className={styles.panel}><WebSpeciesDetail view={view} /></div>} />
}
