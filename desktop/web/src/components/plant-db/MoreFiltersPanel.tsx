import { useSignal } from '@preact/signals'
import { useRef, useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import {
  extraFilters,
  addExtraFilter,
  removeExtraFilter,
  loadDynamicOptions,
  dynamicOptionsCache,
} from '../../state/plant-db'
import { CATEGORIES, fieldsForCategory, type FieldDef, type FilterCategory } from './field-registry'
import { FilterChip } from './FilterChip'
import { RangeSlider } from './RangeSlider'
import styles from './MoreFiltersPanel.module.css'

interface Props {
  open: boolean
  onClose: () => void
}

export function MoreFiltersPanel({ open, onClose }: Props) {
  void locale.value
  const searchQuery = useSignal('')
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Close on click outside — uses pointerup to avoid catching the opening click
  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('pointerup', handler)
    return () => document.removeEventListener('pointerup', handler)
  }, [open, onClose])

  if (!open) return null

  const query = searchQuery.value.toLowerCase()

  return (
    <div className={styles.overlay}>
      <div ref={panelRef} className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title}>{t('filters.moreFilters')}</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('filters.done')}>
            ×
          </button>
        </div>

        {/* Search */}
        <div className={styles.searchRow}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t('filters.searchFields', 'Search fields...')}
            value={searchQuery.value}
            onInput={(e) => { searchQuery.value = (e.target as HTMLInputElement).value }}
          />
        </div>

        {/* Categories */}
        <div className={styles.categories}>
          {CATEGORIES.map((cat) => (
            <CategorySection
              key={cat.key}
              category={cat}
              searchQuery={query}
            />
          ))}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button type="button" className={styles.doneBtn} onClick={onClose}>
            {t('filters.done', 'Done')} <span aria-hidden="true">{'\u203A'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function CategorySection({ category, searchQuery }: {
  category: typeof CATEGORIES[number]
  searchQuery: string
}) {
  void locale.value
  const open = useSignal(false)
  const fields = fieldsForCategory(category.key as FilterCategory)
  const extras = extraFilters.value

  // Filter fields by search query
  const visibleFields = searchQuery
    ? fields.filter((f) => t(f.i18nKey, f.key).toLowerCase().includes(searchQuery))
    : fields

  if (visibleFields.length === 0) return null

  // Count active filters in this category
  const activeCount = extras.filter((ef) =>
    fields.some((f) => f.key === ef.field)
  ).length

  // Auto-open when searching
  const isOpen = open.value || searchQuery.length > 0

  return (
    <div className={styles.categorySection} style={{ '--cat-color': `var(${category.color})` } as Record<string, string>}>
      <button
        type="button"
        className={styles.categoryHeader}
        onClick={() => { open.value = !open.value }}
        aria-expanded={isOpen}
      >
        <span className={styles.categoryTitle}>{t(category.i18nKey, category.key)}</span>
        {activeCount > 0 && <span className={styles.categoryBadge}>{activeCount}</span>}
        <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} aria-hidden="true">›</span>
      </button>

      {isOpen && (
        <div className={styles.categoryContent}>
          {visibleFields.map((field) => (
            <FieldRow key={field.key} field={field} />
          ))}
        </div>
      )}
    </div>
  )
}

function FieldRow({ field }: { field: FieldDef }) {
  void locale.value
  const extras = extraFilters.value
  const cache = dynamicOptionsCache.value
  const expanded = useSignal(false)
  const activeFilter = extras.find((ef) => ef.field === field.key)
  const label = t(field.i18nKey, field.key)

  if (field.type === 'boolean') {
    const isActive = !!activeFilter
    return (
      <div className={styles.fieldRow}>
        <label className={styles.fieldToggle}>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => {
              if ((e.target as HTMLInputElement).checked) {
                addExtraFilter(field.key, 'IsTrue', [])
              } else {
                removeExtraFilter(field.key)
              }
            }}
          />
          <span className={styles.fieldLabel}>{label}</span>
        </label>
      </div>
    )
  }

  // Categorical or numeric — expandable
  const opts = cache[field.key]

  const handleExpand = () => {
    if (!expanded.value && !opts) {
      void loadDynamicOptions([field.key])
    }
    expanded.value = !expanded.value
  }

  return (
    <div className={styles.fieldRow}>
      <button type="button" className={styles.fieldExpandBtn} onClick={handleExpand} aria-expanded={expanded.value}>
        <span className={styles.fieldLabel}>{label}</span>
        {activeFilter && <span className={styles.fieldActiveDot} />}
        <span className={`${styles.chevron} ${expanded.value ? styles.chevronOpen : ''}`} aria-hidden="true">›</span>
      </button>

      {expanded.value && (
        <div className={styles.fieldPicker}>
          {field.type === 'categorical' && opts?.values && (
            <div className={styles.chipGrid}>
              {opts.values.map((v) => {
                const selected = activeFilter?.values.includes(v.value) ?? false
                return (
                  <FilterChip
                    key={v.value}
                    label={v.label}
                    color={field.color}
                    active={selected}
                    onClick={() => {
                      const current = activeFilter?.values ?? []
                      if (selected) {
                        const next = current.filter((x) => x !== v.value)
                        if (next.length === 0) {
                          removeExtraFilter(field.key)
                        } else {
                          addExtraFilter(field.key, 'In', next)
                        }
                      } else {
                        addExtraFilter(field.key, 'In', [...current, v.value])
                      }
                    }}
                  />
                )
              })}
            </div>
          )}

          {field.type === 'numeric' && opts?.range && (
            <RangeSlider
              min={opts.range[0]}
              max={opts.range[1]}
              valueLow={activeFilter?.values[0] != null ? parseFloat(activeFilter.values[0]) : null}
              valueHigh={activeFilter?.values[1] != null ? parseFloat(activeFilter.values[1]) : null}
              onChangeLow={(v) => {
                const high = activeFilter?.values[1] ?? String(opts.range![1])
                if (v === null && (!activeFilter || activeFilter.values[1] === String(opts.range![1]))) {
                  removeExtraFilter(field.key)
                } else {
                  addExtraFilter(field.key, 'Between', [String(v ?? opts.range![0]), high])
                }
              }}
              onChangeHigh={(v) => {
                const low = activeFilter?.values[0] ?? String(opts.range![0])
                if (v === null && (!activeFilter || activeFilter.values[0] === String(opts.range![0]))) {
                  removeExtraFilter(field.key)
                } else {
                  addExtraFilter(field.key, 'Between', [low, String(v ?? opts.range![1])])
                }
              }}
              step={opts.range[1] - opts.range[0] > 100 ? 1 : 0.1}
              ariaLabel={label}
            />
          )}

          {!opts && <span className={styles.loading}>{t('plantDb.loading', 'Loading...')}</span>}
        </div>
      )}
    </div>
  )
}
