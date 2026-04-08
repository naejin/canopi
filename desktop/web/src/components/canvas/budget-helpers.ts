import type { BudgetItem, PlacedPlant } from '../../types/design'
import { groupPlantsBySpecies } from '../../canvas/plant-grouping'

export function countPlants(
  plants: PlacedPlant[],
  localizedNames?: ReadonlyMap<string, string | null>,
): { canonical: string; commonName: string; count: number }[] {
  const grouped = groupPlantsBySpecies(plants, localizedNames)

  return Array.from(grouped.entries())
    .map(([canonical, value]) => ({ canonical, ...value }))
    .sort((left, right) => (left.commonName || left.canonical).localeCompare(right.commonName || right.canonical))
}

export function buildPriceMap(budget: BudgetItem[]): Map<string, { unit_cost: number; currency: string }> {
  return new Map(
    budget
      .filter((item) => item.category === 'plants')
      .map((item) => [item.description, { unit_cost: item.unit_cost, currency: item.currency }]),
  )
}

const _formatterCache = new Map<string, Intl.NumberFormat>()

export function formatCurrency(amount: number, currency: string): string {
  try {
    let formatter = _formatterCache.get(currency)
    if (!formatter) {
      formatter = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      _formatterCache.set(currency, formatter)
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
