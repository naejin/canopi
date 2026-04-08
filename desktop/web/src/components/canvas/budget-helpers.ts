import type { BudgetItem, PlacedPlant } from '../../types/design'
import { groupPlantsBySpecies } from '../../canvas/plant-grouping'
import { getBudgetSpeciesTarget } from '../../panel-targets'

export function countPlants(
  plants: PlacedPlant[],
  localizedNames: ReadonlyMap<string, string | null> | undefined,
  locale: string,
): { canonical: string; commonName: string; count: number }[] {
  const grouped = groupPlantsBySpecies(plants, localizedNames)

  return Array.from(grouped.entries())
    .map(([canonical, value]) => ({ canonical, ...value }))
    .sort((left, right) => (left.commonName || left.canonical).localeCompare(right.commonName || right.canonical, locale))
}

export function buildPriceMap(budget: BudgetItem[]): Map<string, { unit_cost: number; currency: string }> {
  return new Map(
    budget
      .map((item) => {
        const target = getBudgetSpeciesTarget(item)
        return target ? [target.canonical_name, { unit_cost: item.unit_cost, currency: item.currency }] as const : null
      })
      .filter((entry): entry is readonly [string, { unit_cost: number; currency: string }] => entry !== null),
  )
}

const _formatterCache = new Map<string, Intl.NumberFormat>()

export function formatCurrency(amount: number, currency: string, locale?: string): string {
  try {
    const key = locale ? `${locale}:${currency}` : currency
    let formatter = _formatterCache.get(key)
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      _formatterCache.set(key, formatter)
    }
    return formatter.format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function escapeCsvField(value: string): string {
  // Prevent spreadsheet formula injection (OWASP CSV injection)
  const sanitized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
    return `"${sanitized.replace(/"/g, '""')}"`
  }
  return sanitized
}
