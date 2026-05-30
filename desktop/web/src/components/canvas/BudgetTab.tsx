import { useCallback, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import {
  useBudgetPlanningSurface,
} from '../../app/planning-projection'
import { setPlantBudgetPrice, setBudgetCurrency } from '../../app/budget/controller'
import { exportBudgetCsv, isBudgetExportCancelled } from '../../app/budget/export'
import { Dropdown } from '../shared/Dropdown'
import { CURRENCY_ITEMS } from './budget-currencies'
import { formatCurrency } from './budget-helpers'
import styles from './BudgetTab.module.css'

export function BudgetTab() {
  const editingCanonical = useSignal<string | null>(null)
  const editPrice = useSignal('')
  const {
    projection,
    currency,
    designName,
    activeLocale,
    clearHover,
    hoverRow,
    selectRow,
    isRowSelected,
  } = useBudgetPlanningSurface()

  const projectionRef = useRef(projection)
  projectionRef.current = projection

  const startEditPrice = useCallback((canonical: string) => {
    editPrice.value = String(projectionRef.current.lineItemPriceMap.get(canonical)?.unit_cost ?? '')
    editingCanonical.value = canonical
  }, [])

  const commitPrice = useCallback((canonical: string) => {
    if (editingCanonical.value !== canonical) return
    const parsed = parseFloat(editPrice.value)
    if (isFinite(parsed) && parsed >= 0) setPlantBudgetPrice(canonical, parsed)
    editingCanonical.value = null
  }, [])

  async function handleExportCSV() {
    try {
      await exportBudgetCsv(projection.rows, {
        currency,
        designName,
        lineItemPriceMap: projection.lineItemPriceMap,
        grandTotal: projection.grandTotal,
      })
    } catch (error) {
      if (isBudgetExportCancelled(error)) return
      console.error('Budget export failed:', error)
    }
  }

  if (projection.rows.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('canvas.budget.emptyCanvas')}</p>
          <p className={styles.emptyHint}>{t('canvas.budget.emptyHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.summaryStats}>
          {t('canvas.budget.speciesCount', { count: projection.rows.length })}
          <span className={styles.summaryDot}>{' \u00B7 '}</span>
          {t('canvas.budget.plantCount', { count: projection.totalPlants })}
          <span className={styles.summaryDot}>{' \u00B7 '}</span>
          <span className={projection.pricedCount === projection.rows.length && projection.pricedCount > 0 ? styles.pricedComplete : undefined}>
            {t('canvas.budget.pricedProgress', { done: projection.pricedCount, total: projection.rows.length })}
          </span>
        </span>
        <Dropdown
          trigger={currency}
          items={CURRENCY_ITEMS}
          value={currency}
          onChange={setBudgetCurrency}
          menuDirection="down"
          ariaLabel={t('canvas.budget.currencyLabel')}
          triggerClassName={styles.currencyChip}
        />
        <span className={styles.total}>
          {t('canvas.budget.grandTotal')}{' '}{formatCurrency(projection.grandTotal, currency, activeLocale)}
        </span>
        <button type="button" className={styles.exportBtn} onClick={handleExportCSV}>
          {t('canvas.budget.exportCSV')}
        </button>
      </div>

      <div className={styles.tableWrapper} onMouseLeave={clearHover}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thSpecies}>{t('canvas.budget.species')}</th>
              <th className={styles.thNum}>{t('canvas.budget.quantity')}</th>
              <th className={styles.thNum}>{t('canvas.budget.unitCost')}</th>
              <th className={styles.thNum}>{t('canvas.budget.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {projection.rows.map((row) => {
              const isEditing = editingCanonical.value === row.canonical
              const isSelected = isRowSelected(row)

              return (
                <tr
                  key={row.canonical}
                  className={`${styles.row}${isSelected ? ` ${styles.rowSelected}` : ''}`}
                  onClick={() => selectRow(row)}
                  onMouseEnter={() => hoverRow(row)}
                  onMouseLeave={clearHover}
                >
                  <td>
                    <div className={styles.tdSpecies}>
                      <span className={styles.commonName}>{row.commonName || row.canonical}</span>
                      {row.commonName && <>{' '}<span className={styles.canonical}>{row.canonical}</span></>}
                    </div>
                  </td>
                  <td className={styles.tdNum}>{row.count}</td>
                  <td className={styles.tdNum}>
                    {isEditing ? (
                      <input
                        type="number"
                        className={styles.priceInput}
                        value={editPrice.value}
                        min="0"
                        step="0.01"
                        onInput={(event) => { editPrice.value = (event.target as HTMLInputElement).value }}
                        onBlur={() => commitPrice(row.canonical)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitPrice(row.canonical)
                          if (event.key === 'Escape') editingCanonical.value = null
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className={`${styles.priceBtn}${!row.hasPrice ? ` ${styles.priceEmpty}` : ''}`}
                        onClick={() => startEditPrice(row.canonical)}
                        aria-label={`${t('canvas.budget.setPrice')} ${row.commonName || row.canonical}`}
                      >
                        {row.hasPrice ? formatCurrency(row.unitCost, currency, activeLocale) : '\u2014'}
                      </button>
                    )}
                  </td>
                  <td className={styles.tdNum}>{row.hasPrice ? formatCurrency(row.subtotal, currency, activeLocale) : '\u2014'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {projection.pricedCount === 0 && (
          <p className={styles.hint}>{t('canvas.budget.hintSetPrice')}</p>
        )}
      </div>
    </div>
  )
}
