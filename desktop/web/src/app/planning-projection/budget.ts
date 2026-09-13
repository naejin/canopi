import { groupPlantsBySpecies } from '../../canvas/plant-grouping'
import type { PlantSymbolId } from '../../canvas/runtime/scene'
import type { SpeciesKeyEntry } from '../../canvas/runtime/species-key'
import { getBudgetHoverTarget, getBudgetSpeciesTarget } from '../../target'
import type { BudgetItem, PanelTarget, PlacedPlant } from '../../types/design'
import type { BudgetPriceFilter, BudgetSort } from '../planning-view/state'
import { normalizeSearchText } from '../../utils/normalize-search'

export interface BudgetPlanningRow {
  readonly canonical: string
  readonly commonName: string
  readonly code: string
  readonly appearances: readonly { readonly symbol: PlantSymbolId; readonly color: string }[]
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
  readonly zeroPricedCount: number
  readonly grandTotal: number
}

export interface BudgetListProjection {
  readonly rows: readonly BudgetPlanningRow[]
  readonly shownSubtotal: number
  readonly restricted: boolean
}

export interface BuildBudgetPlanningProjectionOptions {
  readonly plants: readonly PlacedPlant[]
  readonly localizedNames?: ReadonlyMap<string, string | null>
  readonly budget: readonly BudgetItem[]
  readonly currency: string
  readonly locale: string
  readonly speciesKey?: readonly SpeciesKeyEntry[]
}

export function buildBudgetPlanningProjection({
  plants,
  localizedNames,
  budget,
  currency,
  locale,
  speciesKey = [],
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
  const identityByCanonical = new Map(speciesKey.map((entry) => [entry.canonicalName, entry]))
  const rows = Array.from(grouped.entries())
    .map(([canonical, value]): BudgetPlanningRow => {
      const item = itemByCanonical.get(canonical) ?? null
      const price = lineItemPriceMap.get(canonical)
      const identity = identityByCanonical.get(canonical)
      const unitCost = price?.unit_cost ?? 0
      return {
        canonical,
        commonName: identity?.commonName ?? value.commonName,
        code: identity?.code ?? '',
        appearances: identity?.appearances ?? [],
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
    zeroPricedCount: rows.filter((row) => row.hasPrice && row.unitCost === 0).length,
    grandTotal: rows.reduce((sum, row) => sum + row.subtotal, 0),
  }
}

export function buildBudgetListProjection(
  projection: BudgetPlanningProjection,
  options: {
    readonly search: string
    readonly sort: BudgetSort
    readonly priceFilter: BudgetPriceFilter
    readonly locale: string
  },
): BudgetListProjection {
  const needle = normalizeSearchText(options.search.trim())
  const nameOrder = (left: BudgetPlanningRow, right: BudgetPlanningRow): number => {
    const localized = (left.commonName || left.canonical).localeCompare(
      right.commonName || right.canonical,
      options.locale,
    )
    return localized || left.canonical.localeCompare(right.canonical)
  }
  const rows = projection.rows
    .filter((row) => {
      if (options.priceFilter === 'no-price' && row.hasPrice) return false
      if (options.priceFilter === 'zero-price' && (!row.hasPrice || row.unitCost !== 0)) return false
      return needle === '' || normalizeSearchText(
        `${row.commonName} ${row.canonical} ${row.code}`,
      ).includes(needle)
    })
    .sort((left, right) => {
      if (options.sort === 'highest-total') {
        if (left.hasPrice !== right.hasPrice) return left.hasPrice ? -1 : 1
        if (left.hasPrice && right.hasPrice && left.subtotal !== right.subtotal) {
          return right.subtotal - left.subtotal
        }
      }
      if (options.sort === 'most-plants' && left.count !== right.count) {
        return right.count - left.count
      }
      return nameOrder(left, right)
    })

  return {
    rows,
    shownSubtotal: rows.reduce((sum, row) => sum + (row.hasPrice ? row.subtotal : 0), 0),
    restricted: needle !== '' || options.priceFilter !== 'all',
  }
}
