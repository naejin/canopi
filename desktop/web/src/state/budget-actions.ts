import { currentDesign, nonCanvasRevision } from './design'
import type { BudgetItem } from '../types/design'

function updateBudget(updater: (budget: BudgetItem[]) => BudgetItem[]): void {
  const design = currentDesign.value
  if (!design) return
  currentDesign.value = {
    ...design,
    budget: updater(design.budget),
  }
  nonCanvasRevision.value += 1
}

export function upsertBudgetItem(predicate: (item: BudgetItem) => boolean, next: BudgetItem): void {
  updateBudget((budget) => {
    const index = budget.findIndex(predicate)
    if (index === -1) return [...budget, next]
    return budget.map((item, itemIndex) => (itemIndex === index ? next : item))
  })
}

export function deleteBudgetItem(predicate: (item: BudgetItem) => boolean): void {
  updateBudget((budget) => budget.filter((item) => !predicate(item)))
}

export function setPlantBudgetPrice(
  canonicalName: string,
  unitCost: number,
  currency: string,
): void {
  upsertBudgetItem(
    (item) => item.category === 'plants' && item.description === canonicalName,
    {
      category: 'plants',
      description: canonicalName,
      quantity: 0,
      unit_cost: unitCost,
      currency,
    },
  )
}
