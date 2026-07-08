import { useEffect, useState } from 'preact/hooks'
import { locale } from '../app/settings/state'
import { speciesCatalogWorkbench } from '../app/plant-browser'
import { writePlantStampDragData } from '../canvas/plant-stamp-source'
import type { SpeciesCatalogDetailView } from '../app/plant-browser/workbench'
import { t } from '../i18n'
import type { SpeciesFilter, SpeciesListItem } from '../types/species'
import styles from './WebSpeciesCatalogPanel.module.css'

interface WebSpeciesCatalogPanelProps {
  readonly mode: 'catalog' | 'favorites'
}

type ArrayFilterKey = 'climate_zones' | 'habit' | 'life_cycle'

export function WebSpeciesCatalogPanel({ mode }: WebSpeciesCatalogPanelProps) {
  const currentLocale = locale.value
  const intent = speciesCatalogWorkbench.intent.value
  const results = speciesCatalogWorkbench.results.value
  const filterOptions = speciesCatalogWorkbench.filterStrip.value.options
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
        <div className={styles.filters}>
          <FilterSelect
            field="climate_zones"
            value={firstFilterValue(intent.filters.climate_zones)}
            values={filterOptions?.climate_zones ?? []}
            label={t('filters.climateZone')}
          />
          <FilterSelect
            field="habit"
            value={firstFilterValue(intent.filters.habit)}
            values={filterOptions?.habits ?? []}
            label={t('filters.field.habit')}
          />
          <FilterSelect
            field="life_cycle"
            value={firstFilterValue(intent.filters.life_cycle)}
            values={filterOptions?.life_cycles ?? []}
            label={t('filters.lifecycle')}
          />
        </div>
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

function FilterSelect({
  field,
  value,
  values,
  label,
}: {
  readonly field: ArrayFilterKey
  readonly value: string
  readonly values: readonly string[]
  readonly label: string
}) {
  return (
    <select
      className={styles.select}
      value={value}
      aria-label={label}
      data-testid={`web-species-filter-${field}`}
      onChange={(event) => {
        patchArrayFilter(field, event.currentTarget.value)
      }}
    >
      <option value="">{label}</option>
      {values.map((option) => (
        <option key={option} value={option}>{translateFilterValue(field, option)}</option>
      ))}
    </select>
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
    </div>
  )
}

function patchArrayFilter(field: ArrayFilterKey, value: string): void {
  speciesCatalogWorkbench.patchFilters({
    [field]: value ? [value] : null,
  } as Partial<SpeciesFilter>)
}

function firstFilterValue(values: readonly string[] | null): string {
  return values?.[0] ?? ''
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

function translateFilterValue(field: ArrayFilterKey, value: string): string {
  const prefix = field === 'climate_zones'
    ? 'filters.climateZone_'
    : field === 'life_cycle'
      ? 'filters.lifeCycle_'
      : 'filters.habit_'
  const key = `${prefix}${value}`
  const translated = t(key)
  return translated === key ? value : translated
}
