import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign, nonCanvasRevision, designName } from '../../state/document'
import { canvasEngine } from '../../canvas/engine'
import { exportFile } from '../../ipc/design'
import type { BudgetItem, PlacedPlant } from '../../types/design'
import styles from './BudgetTab.module.css'

/** Group placed plants by canonical_name, returning count and best display name. */
function countPlants(plants: PlacedPlant[]): { canonical: string; commonName: string; count: number }[] {
  const map = new Map<string, { commonName: string; count: number }>()
  for (const p of plants) {
    const existing = map.get(p.canonical_name)
    if (existing) {
      existing.count++
      // Prefer a non-null common name
      if (!existing.commonName && p.common_name) {
        existing.commonName = p.common_name
      }
    } else {
      map.set(p.canonical_name, {
        commonName: p.common_name ?? '',
        count: 1,
      })
    }
  }
  const result: { canonical: string; commonName: string; count: number }[] = []
  for (const [canonical, { commonName, count }] of map) {
    result.push({ canonical, commonName, count })
  }
  // Sort alphabetically by display name
  result.sort((a, b) => {
    const nameA = a.commonName || a.canonical
    const nameB = b.commonName || b.canonical
    return nameA.localeCompare(nameB)
  })
  return result
}

/** Build a price lookup map from budget items for O(1) access. */
function buildPriceMap(budget: BudgetItem[]): Map<string, { unit_cost: number; currency: string }> {
  const map = new Map<string, { unit_cost: number; currency: string }>()
  for (const b of budget) {
    if (b.category === 'plants') {
      map.set(b.description, { unit_cost: b.unit_cost, currency: b.currency })
    }
  }
  return map
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

export function BudgetTab() {
  // Subscribe to locale for re-render on language change
  void locale.value

  const editingCanonical = useSignal<string | null>(null)
  const editPrice = useSignal<string>('')

  const design = currentDesign.value
  const budget = design?.budget ?? []

  // Build price map once per render (O(n) build, O(1) lookup per row)
  const priceMap = buildPriceMap(budget)

  // Get plant counts from the canvas engine (single call per render)
  const plants = canvasEngine?.getPlacedPlants() ?? []
  const grouped = countPlants(plants)

  // Compute grand total from the same grouped data (no second getPlacedPlants call)
  const grandTotal = grouped.reduce((sum, row) => {
    const price = priceMap.get(row.canonical)?.unit_cost ?? 0
    return sum + row.count * price
  }, 0)

  // Determine default currency from first budget item
  const defaultCurrency = priceMap.values().next().value?.currency ?? 'EUR'

  function startEditPrice(canonical: string) {
    const price = priceMap.get(canonical)?.unit_cost ?? 0
    editPrice.value = price > 0 ? String(price) : ''
    editingCanonical.value = canonical
  }

  function commitPrice(canonical: string) {
    if (!design) return
    const price = parseFloat(editPrice.value) || 0
    const existingIdx = design.budget.findIndex(
      (b) => b.category === 'plants' && b.description === canonical,
    )

    let newBudget: BudgetItem[]
    if (existingIdx >= 0) {
      newBudget = design.budget.map((b, i) =>
        i === existingIdx ? { ...b, unit_cost: price } : b,
      )
    } else {
      newBudget = [
        ...design.budget,
        {
          category: 'plants',
          description: canonical,
          quantity: 0, // quantity is auto-counted, this field is informational
          unit_cost: price,
          currency: defaultCurrency,
        },
      ]
    }

    currentDesign.value = { ...design, budget: newBudget }
    nonCanvasRevision.value++
    editingCanonical.value = null
  }

  function handlePriceKeyDown(e: KeyboardEvent, canonical: string) {
    if (e.key === 'Enter') {
      commitPrice(canonical)
    } else if (e.key === 'Escape') {
      editingCanonical.value = null
    }
  }

  async function handleExportCSV() {
    const rows: string[] = []
    rows.push('Species,Quantity,Unit Price,Subtotal,Currency')
    for (const row of grouped) {
      const entry = priceMap.get(row.canonical)
      const price = entry?.unit_cost ?? 0
      const cur = entry?.currency ?? 'EUR'
      const displayName = row.commonName || row.canonical
      // Escape CSV fields that may contain commas or quotes
      const escaped = displayName.includes(',') || displayName.includes('"')
        ? `"${displayName.replace(/"/g, '""')}"`
        : displayName
      rows.push(`${escaped},${row.count},${price.toFixed(2)},${(row.count * price).toFixed(2)},${cur}`)
    }
    // Grand total row
    rows.push(`${t('canvas.budget.grandTotal')},,,,${grandTotal.toFixed(2)}`)

    const csv = rows.join('\n')
    const fileName = `${designName.value || 'budget'}-budget.csv`

    try {
      await exportFile(csv, fileName, 'CSV', ['csv'])
    } catch {
      // User cancelled dialog — no action needed
    }
  }

  // Empty state: no plants on canvas
  if (grouped.length === 0) {
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
        <span className={styles.autoCountLabel}>
          {t('canvas.budget.autoCount')}
        </span>
        <span className={styles.total} aria-live="polite">
          {t('canvas.budget.grandTotal')}: {formatCurrency(grandTotal, defaultCurrency)}
        </span>
        <button
          type="button"
          className={styles.exportBtn}
          onClick={handleExportCSV}
          aria-label={t('canvas.budget.exportCSV')}
        >
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
            {grouped.map((row, i) => {
              const entry = priceMap.get(row.canonical)
              const price = entry?.unit_cost ?? 0
              const currency = entry?.currency ?? 'EUR'
              const subtotal = row.count * price
              const isEditing = editingCanonical.value === row.canonical

              return (
                <tr
                  key={row.canonical}
                  className={i % 2 === 0 ? styles.rowEven : styles.rowOdd}
                >
                  <td className={styles.tdSpecies}>
                    <span className={styles.commonName}>
                      {row.commonName || row.canonical}
                    </span>
                    {row.commonName && (
                      <span className={styles.canonical}>{row.canonical}</span>
                    )}
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
                        onInput={(e) => {
                          editPrice.value = (e.target as HTMLInputElement).value
                        }}
                        onBlur={() => commitPrice(row.canonical)}
                        onKeyDown={(e) => handlePriceKeyDown(e, row.canonical)}
                        autoFocus
                        aria-label={`${t('canvas.budget.unitCost')} — ${row.commonName || row.canonical}`}
                      />
                    ) : (
                      <button
                        type="button"
                        className={styles.priceBtn}
                        onClick={() => startEditPrice(row.canonical)}
                        aria-label={`${t('canvas.budget.setPrice')} — ${row.commonName || row.canonical}`}
                      >
                        {price > 0
                          ? formatCurrency(price, currency)
                          : t('canvas.budget.setPrice')}
                      </button>
                    )}
                  </td>
                  <td className={styles.tdNum}>
                    {price > 0 ? formatCurrency(subtotal, currency) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td className={styles.totalLabel} colSpan={3}>
                {t('canvas.budget.grandTotal')}
              </td>
              <td className={styles.tdNum} aria-live="polite">
                {formatCurrency(grandTotal, defaultCurrency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
