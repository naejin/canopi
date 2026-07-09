import { useEffect, useState } from 'preact/hooks'
import { locale } from '../app/settings/state'
import { speciesCatalogWorkbench } from '../app/plant-browser'
import { currentCanvasToolCommandSurface } from '../canvas/session'
import {
  beginPlantStampFromSpecies,
  writePlantStampDragData,
} from '../canvas/plant-stamp-source'
import type {
  SpeciesCatalogDetailView,
  SpeciesCatalogFilterStripView,
} from '../app/plant-browser/workbench'
import { t } from '../i18n'
import type { FilterOptions, SpeciesFilter, SpeciesListItem } from '../types/species'
import type { StripChoiceField, StripControlField } from '../app/plant-browser'
import { toggleArrayValue } from '../components/plant-db/filter-utils'
import styles from './WebSpeciesCatalogPanel.module.css'

const MOBILE_FILTER_COLLAPSE_QUERY = '(max-width: 720px)'

interface WebSpeciesCatalogPanelProps {
  readonly mode: 'catalog' | 'favorites'
}

export function WebSpeciesCatalogPanel({ mode }: WebSpeciesCatalogPanelProps) {
  const currentLocale = locale.value
  const intent = speciesCatalogWorkbench.intent.value
  const results = speciesCatalogWorkbench.results.value
  const filterStrip = speciesCatalogWorkbench.filterStrip.value
  const favoritesView = speciesCatalogWorkbench.favorites.value
  const sidebar = speciesCatalogWorkbench.sidebar.value
  const detailView = speciesCatalogWorkbench.detail.value
  const isCatalog = mode === 'catalog'
  const searching = speciesCatalogWorkbench.isSearchLoading(results.status)
  const visibleItems = isCatalog ? results.items : favoritesView.items
  const title = isCatalog ? t('nav.plantDb') : t('nav.favorites')

  useEffect(() => {
    const dispose = speciesCatalogWorkbench.mount()
    speciesCatalogWorkbench.ensureInitialSearch()
    void speciesCatalogWorkbench.loadFilterOptions()
    void speciesCatalogWorkbench.reloadSidebarLists()
    return dispose
  }, [])

  useEffect(() => {
    if (mode === 'favorites') void speciesCatalogWorkbench.loadFavorites()
  }, [mode, currentLocale, favoritesView.revision])

  return (
    <section className={styles.panel} data-testid={`web-species-${mode}-panel`} aria-label={title}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{title}</h2>
          <span className={styles.count}>
            {isCatalog ? results.totalEstimate || visibleItems.length : visibleItems.length}
          </span>
        </div>
        {isCatalog && (
          <input
            type="search"
            className={styles.searchInput}
            value={intent.text}
            placeholder={t('plantDb.searchPlaceholder')}
            onInput={(event) => { speciesCatalogWorkbench.setSearchText(event.currentTarget.value) }}
            data-testid="web-species-search"
          />
        )}
      </header>

      {isCatalog && (
        <WebFilterRegion filterStrip={filterStrip} />
      )}

      <WebSpeciesDetail view={detailView} />

      {isCatalog ? (
        <SpeciesList
          items={visibleItems}
          loading={searching}
          error={results.error}
          emptyLabel={t('plantDb.noResults')}
          hasMore={results.nextCursor !== null}
        />
      ) : (
        <div className={styles.list}>
          <h3 className={styles.sectionTitle}>{t('nav.favorites')}</h3>
          <SpeciesList
            items={visibleItems}
            loading={favoritesView.loading}
            error={null}
            emptyLabel={t('plantDb.noFavorites')}
            hasMore={false}
          />
          <h3 className={styles.sectionTitle}>{t('plantDb.recentlyViewed')}</h3>
          <div className={styles.recentList}>
            {sidebar.recentlyViewed.length === 0 ? (
              <div className={styles.empty}>{t('plantDb.noRecentlyViewed')}</div>
            ) : (
              sidebar.recentlyViewed.map((item) => <SpeciesRow key={item.canonical_name} item={item} />)
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function WebFilterRegion({
  filterStrip,
}: {
  readonly filterStrip: SpeciesCatalogFilterStripView
}) {
  const isCompactFilterLayout = useSmallSpeciesFilterLayout()
  const [expanded, setExpanded] = useState(false)
  const controls = filterStrip.controls.filter((control): control is StripChoiceField => (
    control.kind === 'choice' && (filterStrip.options?.[control.optionsKey] ?? []).length > 0
  ))

  if (controls.length === 0) return null

  const collapsed = isCompactFilterLayout && !expanded
  const summary = filterStrip.hasActive
    ? t('plantDb.filterSummaryActive', { count: filterStrip.activeCount })
    : t('plantDb.filterSummaryInactive')

  return (
    <div
      className={`${styles.filterRegion} ${collapsed ? styles.filterRegionCollapsed : ''}`}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {isCompactFilterLayout && (
        <button
          type="button"
          className={styles.filterSummaryButton}
          aria-expanded={!collapsed}
          data-testid="web-species-filter-summary"
          onClick={() => setExpanded((current) => !current)}
        >
          <span className={styles.filterSummaryTitle}>{t('plantDb.filters')}</span>
          <span className={styles.filterSummaryStatus}>{summary}</span>
          <span className={styles.filterSummaryChevron} aria-hidden="true">
            {collapsed ? '+' : '-'}
          </span>
        </button>
      )}
      {!collapsed && (
        <>
          <div className={styles.filterRows}>
            {controls.map((control) => (
              <WebFilterControl
                key={control.filterKey}
                control={control}
                filters={filterStrip.filters}
                options={filterStrip.options}
              />
            ))}
          </div>
          {filterStrip.hasActive && (
            <div className={styles.activeFilters}>
              <WebActiveFilterChips
                controls={controls}
                filters={filterStrip.filters}
              />
              <button
                type="button"
                className={styles.clearFiltersButton}
                data-testid="web-species-clear-filters"
                onClick={() => { speciesCatalogWorkbench.clearFilters() }}
              >
                {t('filters.clearAll')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function useSmallSpeciesFilterLayout(): boolean {
  const [isSmall, setIsSmall] = useState(() => matchesSmallSpeciesFilterLayout())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const media = window.matchMedia(MOBILE_FILTER_COLLAPSE_QUERY)
    const update = () => setIsSmall(media.matches)
    update()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    media.addListener?.(update)
    return () => {
      media.removeListener?.(update)
    }
  }, [])

  return isSmall
}

function matchesSmallSpeciesFilterLayout(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_FILTER_COLLAPSE_QUERY).matches
}

function WebFilterControl({
  control,
  filters,
  options,
}: {
  readonly control: StripChoiceField
  readonly filters: SpeciesFilter
  readonly options: FilterOptions | null
}) {
  const values = options?.[control.optionsKey] ?? []
  if (values.length === 0) return null
  const activeValues = (filters[control.filterKey] as string[] | null) ?? []

  return (
    <div className={styles.filterRow} data-testid={`web-species-filter-${control.filterKey}`}>
      <span className={styles.filterLabel}>{t(control.labelI18nKey, control.fallbackLabel)}</span>
      <div className={styles.filterChoices}>
        {values.map((value) => {
          const active = activeValues.includes(value)
          return (
            <button
              key={value}
              type="button"
              className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
              aria-pressed={active}
              data-testid={`web-species-filter-${control.filterKey}-${value}`}
              onClick={() => {
                speciesCatalogWorkbench.patchFilters({
                  [control.filterKey]: toggleArrayValue(filters[control.filterKey] as string[] | null, value),
                } as Partial<SpeciesFilter>)
              }}
            >
              {translateChoiceValue(control, value)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WebActiveFilterChips({
  controls,
  filters,
}: {
  readonly controls: readonly StripControlField[]
  readonly filters: SpeciesFilter
}) {
  const chips = controls.flatMap((control) => {
    if (control.kind !== 'choice') return []
    const values = filters[control.filterKey] as string[] | null
    return (values ?? []).map((value) => ({ control, value }))
  })

  if (chips.length === 0) return null

  return (
    <div className={styles.activeChips} aria-label={t('filters.activeFilters', 'Active filters')}>
      {chips.map(({ control, value }) => (
        <button
          key={`${control.filterKey}-${value}`}
          type="button"
          className={styles.activeChip}
          data-testid={`web-species-active-filter-${control.filterKey}-${value}`}
          onClick={() => {
            speciesCatalogWorkbench.patchFilters({
              [control.filterKey]: toggleArrayValue(filters[control.filterKey] as string[] | null, value),
            } as Partial<SpeciesFilter>)
          }}
        >
          {translateChoiceValue(control, value)}
          <span aria-hidden="true">×</span>
        </button>
      ))}
    </div>
  )
}

function WebSpeciesDetail({ view }: { readonly view: SpeciesCatalogDetailView }) {
  const imageUrl = view.detail?.image?.url ?? null
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [imageUrl])

  if (!view.canonicalName) return null

  if (view.loading) {
    return <div className={styles.detailShell}>{t('plantDetail.loading')}</div>
  }

  if (view.error) {
    return <div className={styles.detailShell} role="alert">{view.error}</div>
  }

  if (!view.detail) return null

  const detail = view.detail
  const title = detail.common_name ?? detail.canonical_name
  const commonNames = detail.common_names.filter((name) => name !== title)
  const formValues = [...new Set([
    ...compact([detail.habit, detail.growth_form]),
  ])]
  const showImage = detail.image !== null && !imageFailed

  return (
    <article className={styles.detailShell} data-testid="web-species-detail">
      <div className={styles.detailHero}>
        {showImage ? (
          <img
            src={detail.image!.url}
            alt={title}
            loading="lazy"
            className={styles.detailImage}
            onError={() => setImageFailed(true)}
            data-testid="web-species-detail-image"
          />
        ) : (
          <div className={styles.detailImageFallback}>{t('plantDetail.noPhotos')}</div>
        )}
      </div>
      <div className={styles.detailBody}>
        <div className={styles.detailTitleRow}>
          <div className={styles.detailNames}>
            <h3 className={styles.detailTitle}>{title}</h3>
            <p className={styles.detailBotanical}>{detail.canonical_name}</p>
          </div>
          <button
            type="button"
            className={styles.detailClose}
            onClick={() => { speciesCatalogWorkbench.closeSpeciesDetail() }}
            aria-label={t('plantDetail.back')}
          >
            ×
          </button>
        </div>
        {commonNames.length > 0 && (
          <Field label={t('webSpeciesDetail.commonNames')} values={commonNames} />
        )}
        <Field label={t('plantDetail.climateZones')} values={detail.climate_zones} />
        <Field label={t('plantDetail.growthForm')} values={formValues} />
        <Field label={t('filters.lifecycle')} values={detail.life_cycles} />
      </div>
    </article>
  )
}

function Field({
  label,
  values,
}: {
  readonly label: string
  readonly values: readonly string[]
}) {
  if (values.length === 0) return null
  return (
    <div className={styles.detailField}>
      <span className={styles.detailFieldLabel}>{label}</span>
      <span className={styles.detailFieldValue}>{values.join(' · ')}</span>
    </div>
  )
}

function SpeciesList({
  items,
  loading,
  error,
  emptyLabel,
  hasMore,
}: {
  readonly items: readonly SpeciesListItem[]
  readonly loading: boolean
  readonly error: string | null
  readonly emptyLabel: string
  readonly hasMore: boolean
}) {
  if (loading && items.length === 0) {
    return <div className={styles.loading}>{t('plantDb.loading')}</div>
  }

  if (error !== null && items.length === 0) {
    return (
      <div className={styles.error} role="alert">
        <span>{error}</span>
        <button
          type="button"
          className={styles.retryButton}
          onClick={() => { speciesCatalogWorkbench.retrySearch() }}
          data-testid="web-species-retry"
        >
          {t('plantDb.retry')}
        </button>
      </div>
    )
  }

  if (items.length === 0) {
    return <div className={styles.empty}>{emptyLabel}</div>
  }

  return (
    <div className={styles.list}>
      {items.map((item) => <SpeciesRow key={item.canonical_name} item={item} />)}
      {hasMore && (
        <button
          type="button"
          className={styles.loadMoreButton}
          onClick={() => { void speciesCatalogWorkbench.loadNextPage() }}
          data-testid="web-species-load-more"
        >
          {t('plantDb.loadMore')}
        </button>
      )}
    </div>
  )
}

function SpeciesRow({ item }: { readonly item: SpeciesListItem }) {
  const commandSurface = currentCanvasToolCommandSurface.value
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
      onClick={() => { speciesCatalogWorkbench.selectSpecies(item.canonical_name) }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        speciesCatalogWorkbench.selectSpecies(item.canonical_name)
      }}
      role="button"
      tabIndex={0}
      data-testid="web-species-row"
    >
      <span className={styles.nameBlock}>
        <span className={styles.commonName}>{item.common_name ?? item.canonical_name}</span>
        <span className={styles.botanicalName}>{item.canonical_name}</span>
        <span className={styles.metadata}>{metadataLabel(item)}</span>
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
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            void speciesCatalogWorkbench.toggleFavorite(item.canonical_name)
          }}
        >
          {item.is_favorite ? '★' : '☆'}
        </button>
      </span>
    </div>
  )
}

function metadataLabel(item: SpeciesListItem): string {
  return [
    ...item.climate_zones,
    ...item.life_cycles,
  ].join(' · ')
}

function compact(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function translateChoiceValue(control: StripChoiceField, value: string): string {
  const key = `${control.valueI18nPrefix}${value}`
  const translated = t(key)
  return translated === key ? value : translated
}
