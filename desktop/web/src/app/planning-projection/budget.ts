import { groupPlantsBySpecies } from '../../canvas/plant-grouping'
import { getBudgetHoverTarget, getBudgetSpeciesTarget } from '../../panel-targets'
import type { BudgetItem, PanelTarget, PlacedPlant } from '../../types/design'

export interface BudgetPlanningRow {
  readonly canonical: string
  readonly commonName: string
  readonly count: number
  readonly target: PanelTarget
  readonly item: BudgetItem | null
  readonly hasPrice: boolean
  readonly unitCost: number
  readonly currency: string
  readonly subtotal: number
}

export interface BudgetPlanningProjection {
  readonly rows: readonly BudgetPlanningRow[]
  readonly lineItemPriceMap: ReadonlyMap<string, { unit_cost: number; currency: string }>
  readonly itemByCanonical: ReadonlyMap<string, BudgetItem>
  readonly totalPlants: number
  readonly pricedCount: number
  readonly grandTotal: number
}

export interface BuildBudgetPlanningProjectionOptions {
  readonly plants: readonly PlacedPlant[]
  readonly localizedNames?: ReadonlyMap<string, string | null>
  readonly budget: readonly BudgetItem[]
  readonly currency: string
  readonly locale: string
}

export function buildBudgetPlanningProjection({
  plants,
  localizedNames,
  budget,
  currency,
  locale,
}: BuildBudgetPlanningProjectionOptions): BudgetPlanningProjection {
  const itemByCanonical = new Map<string, BudgetItem>()
  const lineItemPriceMap = new Map<string, { unit_cost: number; currency: string }>()

  for (const item of budget) {
    const target = getBudgetSpeciesTarget(item)
    if (!target) continue
    itemByCanonical.set(target.canonical_name, item)
    lineItemPriceMap.set(target.canonical_name, {
      unit_cost: item.unit_cost,
      currency: item.currency,
    })
  }

  const grouped = groupPlantsBySpecies(plants, localizedNames)
  const rows = Array.from(grouped.entries())
    .map(([canonical, value]): BudgetPlanningRow => {
      const item = itemByCanonical.get(canonical) ?? null
      const price = lineItemPriceMap.get(canonical)
      const unitCost = price?.unit_cost ?? 0
      return {
        canonical,
        commonName: value.commonName,
        count: value.count,
        target: getBudgetHoverTarget(item, canonical),
        item,
        hasPrice: price !== undefined,
        unitCost,
        currency: price?.currency ?? currency,
        subtotal: value.count * unitCost,
      }
    })
    .sort((left, right) => (
      (left.commonName || left.canonical).localeCompare(right.commonName || right.canonical, locale)
    ))

  return {
    rows,
    lineItemPriceMap,
    itemByCanonical,
    totalPlants: rows.reduce((sum, row) => sum + row.count, 0),
    pricedCount: rows.filter((row) => row.hasPrice).length,
    grandTotal: rows.reduce((sum, row) => sum + row.subtotal, 0),
  }
}
