import { orderingForField } from '../../generated/plant-filter-fields'

export function orderFilterValues<T extends { value: string }>(field: string, values: T[]): T[] {
  const order = orderingForField(field)
  if (!order) return values

  const rankMap = new Map(order.map((value, index) => [value, index]))
  const ranked: T[] = []
  const unranked: T[] = []

  for (const item of values) {
    if (rankMap.has(item.value)) {
      ranked.push(item)
    } else {
      unranked.push(item)
    }
  }

  ranked.sort((a, b) => rankMap.get(a.value)! - rankMap.get(b.value)!)
  return [...ranked, ...unranked]
}
