import { t } from '../../i18n'
import { useBudgetItemWorkbench } from '../../app/budget/workbench'
import { Dropdown } from '../shared/Dropdown'
import { CURRENCY_ITEMS } from './budget-currencies'
import styles from './BudgetTab.module.css'

export function BudgetTab() {
  const workbench = useBudgetItemWorkbench()
  const { projection, currency } = workbench

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
          onChange={workbench.setCurrency}
          menuDirection="down"
          ariaLabel={t('canvas.budget.currencyLabel')}
          triggerClassName={styles.currencyChip}
        />
        <span className={styles.total}>
          {t('canvas.budget.grandTotal')}{' '}{workbench.formatCurrency(projection.grandTotal)}
        </span>
        <button type="button" className={styles.exportBtn} onClick={workbench.exportCsv}>
          {t('canvas.budget.exportCSV')}
        </button>
      </div>

      <div className={styles.tableWrapper} onMouseLeave={workbench.clearHover}>
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
              const isEditing = workbench.editingCanonical === row.canonical
              const isSelected = workbench.isRowSelected(row)

              return (
                <tr
                  key={row.canonical}
                  className={`${styles.row}${isSelected ? ` ${styles.rowSelected}` : ''}`}
                  onClick={() => workbench.selectRow(row)}
                  onMouseEnter={() => workbench.hoverRow(row)}
                  onMouseLeave={workbench.clearHover}
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
                        value={workbench.editPrice}
                        min="0"
                        step="0.01"
                        onInput={(event) => {
                          workbench.setEditPrice((event.target as HTMLInputElement).value)
                        }}
                        onBlur={() => workbench.commitPriceEdit(row.canonical)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') workbench.commitPriceEdit(row.canonical)
                          if (event.key === 'Escape') workbench.cancelPriceEdit()
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className={`${styles.priceBtn}${!row.hasPrice ? ` ${styles.priceEmpty}` : ''}`}
                        onClick={() => workbench.startPriceEdit(row.canonical)}
                        aria-label={`${t('canvas.budget.setPrice')} ${row.commonName || row.canonical}`}
                      >
                        {row.hasPrice ? workbench.formatCurrency(row.unitCost) : '\u2014'}
                      </button>
                    )}
                  </td>
                  <td className={styles.tdNum}>{row.hasPrice ? workbench.formatCurrency(row.subtotal) : '\u2014'}</td>
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
