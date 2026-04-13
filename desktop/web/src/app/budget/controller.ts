import type { BudgetItem } from '../../types/design'
import { getBudgetSpeciesTarget, panelTargetEqual, speciesBudgetTarget } from '../../panel-targets'
import { mutateCurrentDesign } from '../document/controller'

export function setBudgetCurrency(currency: string): void {
  mutateCurrentDesign((design) => {
    if (design.budget_currency === currency) return design
    return {
      ...design,
      budget_currency: currency,
      budget: design.budget.map((item) => ({ ...item, currency })),
    }
  })
}

export function setPlantBudgetPrice(canonicalName: string, unitCost: number): void {
  const sanitized = Math.max(0, isFinite(unitCost) ? unitCost : 0)
  const target = speciesBudgetTarget(canonicalName)
  mutateCurrentDesign((design) => {
    const currency = design.budget_currency ?? 'EUR'
    const budget = design.budget
    const index = budget.findIndex((item) => {
      const itemTarget = getBudgetSpeciesTarget(item)
      return itemTarget !== null && panelTargetEqual(itemTarget, target)
    })
    const existing = index !== -1 ? budget[index] : undefined
    if (existing && existing.unit_cost === sanitized && existing.currency === currency) return design

    const next: BudgetItem = {
      target,
      category: 'plants',
      description: canonicalName,
      quantity: existing?.quantity ?? 0,
      unit_cost: sanitized,
      currency,
    }

    return {
      ...design,
      budget_currency: currency,
      budget: index === -1
        ? [...budget, next]
        : budget.map((item, itemIndex) => (itemIndex === index ? next : item)),
    }
  })
}
