import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { sceneEntityRevision, plantNamesRevision } from '../../state/canvas'
import { currentDesign, designName } from '../../state/document'
import { currentCanvasSession } from '../../canvas/session'
import { exportFile } from '../../ipc/design'
import { setPlantBudgetPrice } from '../../state/budget-actions'
import type { BudgetItem, PlacedPlant } from '../../types/design'
import styles from './BudgetTab.module.css'

function countPlants(
  plants: PlacedPlant[],
  localizedNames?: ReadonlyMap<string, string | null>,
): { canonical: string; commonName: string; count: number }[] {
  const grouped = new Map<string, { commonName: string; count: number }>()
  for (const plant of plants) {
    const existing = grouped.get(plant.canonical_name)
    if (existing) {
      existing.count += 1
      if (!existing.commonName && plant.common_name) existing.commonName = plant.common_name
      continue
    }
    const localized = localizedNames?.get(plant.canonical_name)
    grouped.set(plant.canonical_name, {
      commonName: localized ?? plant.common_name ?? '',
      count: 1,
    })
  }

  return Array.from(grouped.entries())
    .map(([canonical, value]) => ({ canonical, ...value }))
    .sort((left, right) => (left.commonName || left.canonical).localeCompare(right.commonName || right.canonical))
}

function buildPriceMap(budget: BudgetItem[]): Map<string, { unit_cost: number; currency: string }> {
  return new Map(
    budget
      .filter((item) => item.category === 'plants')
      .map((item) => [item.description, { unit_cost: item.unit_cost, currency: item.currency }]),
  )
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function BudgetTab() {
  void locale.value
  void sceneEntityRevision.value
  void plantNamesRevision.value
  const session = currentCanvasSession.value

  const editingCanonical = useSignal<string | null>(null)
  const editPrice = useSignal('')

  const design = currentDesign.value
  const budget = design?.budget ?? []
  const plants = session?.getPlacedPlants() ?? design?.plants ?? []
  const localizedNames = session?.getLocalizedCommonNames()
  const groupedPlants = countPlants(plants, localizedNames)
  const priceMap = buildPriceMap(budget)
  const defaultCurrency = priceMap.values().next().value?.currency ?? 'EUR'
  const grandTotal = groupedPlants.reduce((total, row) => {
    const entry = priceMap.get(row.canonical)
    return total + row.count * (entry?.unit_cost ?? 0)
  }, 0)

  function startEditPrice(canonical: string) {
    editPrice.value = String(priceMap.get(canonical)?.unit_cost ?? '')
    editingCanonical.value = canonical
  }

  function commitPrice(canonical: string) {
    if (editingCanonical.value !== canonical) return
    setPlantBudgetPrice(canonical, parseFloat(editPrice.value) || 0, defaultCurrency)
    editingCanonical.value = null
  }

  async function handleExportCSV() {
    const rows = ['Species,Quantity,Unit Price,Subtotal,Currency']
    for (const row of groupedPlants) {
      const entry = priceMap.get(row.canonical)
      const price = entry?.unit_cost ?? 0
      const currency = entry?.currency ?? defaultCurrency
      const displayName = row.commonName || row.canonical
      rows.push(`${escapeCsvField(displayName)},${row.count},${price.toFixed(2)},${(row.count * price).toFixed(2)},${currency}`)
    }
    rows.push(`${t('canvas.budget.grandTotal')},,,,${grandTotal.toFixed(2)}`)

    try {
      await exportFile(rows.join('\n'), `${designName.value || 'budget'}-budget.csv`, 'CSV', ['csv'])
    } catch {
      // User cancelled export.
    }
  }

  if (groupedPlants.length === 0) {
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
        <span className={styles.autoCountLabel}>{t('canvas.budget.autoCount')}</span>
        <span className={styles.total}>
          {t('canvas.budget.grandTotal')}: {formatCurrency(grandTotal, defaultCurrency)}
        </span>
        <button type="button" className={styles.exportBtn} onClick={handleExportCSV}>
          {t('canvas.budget.exportCSV')}
        </button>
      </div>

      <div className={styles.tableWrapper}>
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
            {groupedPlants.map((row, index) => {
              const entry = priceMap.get(row.canonical)
              const price = entry?.unit_cost ?? 0
              const currency = entry?.currency ?? defaultCurrency
              const subtotal = row.count * price
              const isEditing = editingCanonical.value === row.canonical

              return (
                <tr key={row.canonical} className={index % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                  <td className={styles.tdSpecies}>
                    <span className={styles.commonName}>{row.commonName || row.canonical}</span>
                    {row.commonName && <span className={styles.canonical}>{row.canonical}</span>}
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
                      <button type="button" className={styles.priceBtn} onClick={() => startEditPrice(row.canonical)}>
                        {price > 0 ? formatCurrency(price, currency) : t('canvas.budget.setPrice')}
                      </button>
                    )}
                  </td>
                  <td className={styles.tdNum}>{price > 0 ? formatCurrency(subtotal, currency) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td className={styles.totalLabel} colSpan={3}>{t('canvas.budget.grandTotal')}</td>
              <td className={styles.tdNum}>{formatCurrency(grandTotal, defaultCurrency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
