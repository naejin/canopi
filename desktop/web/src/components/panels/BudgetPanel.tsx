import { useLayoutEffect, useRef } from 'preact/hooks'
import { useBudgetItemWorkbench } from '../../app/budget/workbench'
import type { BudgetPriceFilter, BudgetSort } from '../../app/planning-view/state'
import { t } from '../../i18n'
import { DockPanelHeader } from '../shared/DockPanelHeader'
import { Dropdown, type DropdownItem } from '../shared/Dropdown'
import { SpeciesIdentity } from '../shared/SpeciesIdentity'
import { SurfaceSearch } from '../shared/SurfaceSearch'
import { PlantSymbolGlyph } from '../canvas/PlantSymbolGlyph'
import { CURRENCY_ITEMS } from '../canvas/budget-currencies'
import { sidePanel } from '../../app/shell/state'
import styles from './BudgetPanel.module.css'

export function BudgetPanel() {
  const workbench = useBudgetItemWorkbench()
  const scrollRef = useRef<HTMLUListElement>(null)
  const cancelledPriceFocus = useRef<string | null>(null)
  const { projection, list } = workbench
  const sortItems: DropdownItem<BudgetSort>[] = [
    { value: 'name', label: t('canvas.budget.sortName') },
    { value: 'highest-total', label: t('canvas.budget.sortHighestTotal') },
    { value: 'most-plants', label: t('canvas.budget.sortMostPlants') },
  ]
  const priceFilterItems: DropdownItem<BudgetPriceFilter>[] = [
    { value: 'all', label: t('canvas.budget.filterAll') },
    { value: 'no-price', label: t('canvas.budget.filterNoPrice') },
    { value: 'zero-price', label: t('canvas.budget.filterZeroPrice') },
  ]

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = workbench.scrollTop
  }, [workbench.scrollTop])
  useLayoutEffect(() => {
    if (workbench.editingCanonical !== null || cancelledPriceFocus.current === null) return
    document.querySelector<HTMLButtonElement>(
      `button[data-budget-price="${encodeURIComponent(cancelledPriceFocus.current)}"]`,
    )?.focus()
    cancelledPriceFocus.current = null
  }, [workbench.editingCanonical])

  return (
    <section
      className={styles.panel}
      aria-label={t('canvas.budget.title')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || workbench.editingCanonical !== null) return
        event.preventDefault()
        event.stopPropagation()
        sidePanel.value = null
        document.querySelector<HTMLButtonElement>('button[data-panel="budget"]')?.focus()
      }}
    >
      <DockPanelHeader title={t('canvas.budget.title')} count={projection.rows.length} />
      <div className={styles.controls}>
        <SurfaceSearch
          value={workbench.search}
          onChange={workbench.setSearch}
          label={t('canvas.budget.search')}
        />
        <div className={styles.controlRow}>
          <Dropdown
            trigger={sortItems.find((item) => item.value === workbench.sort)?.label}
            items={sortItems}
            value={workbench.sort}
            onChange={workbench.setSort}
            ariaLabel={t('canvas.budget.sortLabel')}
          />
          <Dropdown
            trigger={priceFilterItems.find((item) => item.value === workbench.priceFilter)?.label}
            items={priceFilterItems}
            value={workbench.priceFilter}
            onChange={workbench.setPriceFilter}
            ariaLabel={t('canvas.budget.priceFilterLabel')}
          />
        </div>
      </div>

      {projection.rows.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('canvas.budget.emptyCanvas')}</p>
          <p>{t('canvas.budget.emptyHint')}</p>
        </div>
      ) : list.rows.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('canvas.budget.noResults')}</p>
          <button type="button" className={styles.textButton} onClick={() => {
            workbench.setSearch('')
            workbench.setPriceFilter('all')
          }}>{t('canvas.budget.clearFilters')}</button>
        </div>
      ) : (
        <ul
          ref={scrollRef}
          className={styles.list}
          onScroll={(event) => workbench.setScrollTop(event.currentTarget.scrollTop)}
          onMouseLeave={workbench.clearHover}
        >
          {list.rows.map((row) => {
            const editing = workbench.editingCanonical === row.canonical
            const inputId = `budget-price-${encodeURIComponent(row.canonical)}`
            const errorId = `${inputId}-error`
            return (
              <li
                key={row.canonical}
                className={styles.row}
                onMouseEnter={() => workbench.hoverRow(row)}
                onMouseLeave={workbench.clearHover}
              >
                <button
                  type="button"
                  className={styles.identityButton}
                  aria-pressed={workbench.focusedCanonical === row.canonical}
                  onClick={() => workbench.toggleSpeciesFocus(row.canonical)}
                >
                  <SpeciesIdentity
                    commonName={row.commonName}
                    canonicalName={row.canonical}
                    mark={row.appearances.map((appearance) => (
                      <span key={`${appearance.color}:${appearance.symbol}`} style={{ color: appearance.color }}>
                        <PlantSymbolGlyph symbol={appearance.symbol} size={20} />
                      </span>
                    ))}
                    detail={row.code ? <span className={styles.code}>{row.code}</span> : undefined}
                  />
                </button>
                <div className={styles.priceLine}>
                  <span className={styles.calculation}>
                    {row.count} ×{' '}
                    {editing ? (
                      <span className={styles.editor}>
                        <label className={styles.srOnly} for={inputId}>
                          {t('canvas.budget.priceFor', { name: row.commonName || row.canonical })}
                        </label>
                        <input
                          id={inputId}
                          type="number"
                          className={styles.priceInput}
                          value={workbench.editPrice}
                          min="0"
                          step="0.01"
                          aria-invalid={workbench.priceInvalid}
                          aria-describedby={workbench.priceInvalid ? errorId : undefined}
                          onInput={(event) => workbench.setEditPrice(event.currentTarget.value)}
                          onBlur={() => workbench.commitPriceEdit(row.canonical)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              workbench.commitPriceEdit(row.canonical, true)
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              event.stopPropagation()
                              cancelledPriceFocus.current = row.canonical
                              workbench.cancelPriceEdit()
                            }
                          }}
                          autoFocus
                        />
                        {workbench.priceInvalid && (
                          <span id={errorId} className={styles.validation} role="alert">
                            {t('canvas.budget.priceError')}
                          </span>
                        )}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={styles.priceButton}
                        data-budget-price={encodeURIComponent(row.canonical)}
                        onClick={() => workbench.startPriceEdit(row.canonical)}
                        aria-label={t('canvas.budget.priceFor', { name: row.commonName || row.canonical })}
                      >
                        {row.hasPrice ? workbench.formatCurrency(row.unitCost) : '—'}
                      </button>
                    )}
                  </span>
                  <strong className={styles.lineTotal}>
                    {row.hasPrice ? workbench.formatCurrency(row.subtotal) : '—'}
                  </strong>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <footer className={styles.footer}>
        <div className={styles.summary}>
          <span>{t('canvas.budget.designCounts', {
            species: projection.rows.length,
            plants: projection.totalPlants,
          })}</span>
          <span>{t('canvas.budget.priceCoverage', {
            priced: projection.pricedCount,
            zero: projection.zeroPricedCount,
          })}</span>
        </div>
        {list.restricted && (
          <div className={styles.totalLine}>
            <span>{t('canvas.budget.shownSubtotal')}</span>
            <strong>{workbench.formatCurrency(list.shownSubtotal)}</strong>
          </div>
        )}
        <div className={styles.totalLine}>
          <span>{t('canvas.budget.designTotal')}</span>
          <strong>{workbench.formatCurrency(projection.grandTotal)}</strong>
        </div>
        <div className={styles.footerActions}>
          <Dropdown
            trigger={workbench.currency}
            items={CURRENCY_ITEMS}
            value={workbench.currency}
            onChange={workbench.setCurrency}
            menuDirection="up"
            ariaLabel={t('canvas.budget.currencyLabel')}
          />
          <button
            type="button"
            className={styles.exportButton}
            onClick={() => { void workbench.exportCsv() }}
            disabled={workbench.exportPending}
          >
            {workbench.exportPending ? t('canvas.budget.exporting') : t('canvas.budget.exportAllCSV')}
          </button>
        </div>
        <p className={styles.currencyHelp}>{t('canvas.budget.currencyHelp')}</p>
        {workbench.exportFailed && (
          <div className={styles.exportError} role="alert">
            <span>{t('canvas.budget.exportFailed')}</span>
            <button type="button" onClick={() => { void workbench.exportCsv() }}>
              {t('canvas.budget.retryExport')}
            </button>
          </div>
        )}
      </footer>
    </section>
  )
}
