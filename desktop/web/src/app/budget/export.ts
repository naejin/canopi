import { exportFile } from '../../ipc/design'
import { t } from '../../i18n'
import { escapeCsvField } from '../../components/canvas/budget-helpers'

export interface BudgetExportRow {
  canonical: string
  commonName: string
  count: number
}

export function isBudgetExportCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === 'Dialog cancelled'
}

export async function exportBudgetCsv(
  rows: readonly BudgetExportRow[],
  options: {
    currency: string
    designName: string
    lineItemPriceMap: ReadonlyMap<string, { unit_cost: number; currency: string }>
    grandTotal: number
  },
): Promise<void> {
  const header = [
    t('canvas.budget.species'),
    t('canvas.budget.quantity'),
    t('canvas.budget.unitCost'),
    t('canvas.budget.lineTotal'),
    t('canvas.budget.currency'),
  ].map(escapeCsvField).join(',')

  const csvRows = [header]
  for (const row of rows) {
    const entry = options.lineItemPriceMap.get(row.canonical)
    const price = entry?.unit_cost ?? 0
    const displayName = row.commonName || row.canonical
    csvRows.push(
      `${escapeCsvField(displayName)},${row.count},${price.toFixed(2)},${(row.count * price).toFixed(2)},${options.currency}`,
    )
  }
  csvRows.push(`${escapeCsvField(t('canvas.budget.grandTotal'))},,,${options.grandTotal.toFixed(2)},`)

  await exportFile(
    csvRows.join('\n'),
    `${options.designName || 'budget'}-budget.csv`,
    'CSV',
    ['csv'],
  )
}
