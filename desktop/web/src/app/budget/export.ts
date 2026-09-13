import { deliverBudgetCsv } from '#budget-export-platform'
import { t } from '../../i18n'
import { escapeBudgetCsvField } from './formatting'

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
  ].map(escapeBudgetCsvField).join(',')

  const csvRows = [header]
  for (const row of rows) {
    const entry = options.lineItemPriceMap.get(row.canonical)
    const displayName = row.commonName || row.canonical
    const priceColumns = entry
      ? `${entry.unit_cost.toFixed(2)},${(row.count * entry.unit_cost).toFixed(2)}`
      : ','
    csvRows.push(`${escapeBudgetCsvField(displayName)},${row.count},${priceColumns},${options.currency}`)
  }
  csvRows.push(`${escapeBudgetCsvField(t('canvas.budget.grandTotal'))},,,${options.grandTotal.toFixed(2)},`)

  await deliverBudgetCsv(
    csvRows.join('\n'),
    `${options.designName || 'budget'}-budget.csv`,
  )
}
