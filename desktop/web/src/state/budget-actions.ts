import type { BudgetItem } from '../types/design'
import { mutateCurrentDesign } from './document-mutations'

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

export function setPlantBudgetPrice(
  canonicalName: string,
  unitCost: number,
): void {
  const sanitized = Math.max(0, isFinite(unitCost) ? unitCost : 0)
  mutateCurrentDesign((design) => {
    const currency = design.budget_currency ?? 'EUR'
    const budget = design.budget
    const index = budget.findIndex((item) => item.category === 'plants' && item.description === canonicalName)
    const existing = index !== -1 ? budget[index] : undefined
    if (existing && existing.unit_cost === sanitized && existing.currency === currency) return design
    const next: BudgetItem = { category: 'plants', description: canonicalName, quantity: existing?.quantity ?? 0, unit_cost: sanitized, currency }
    return {
      ...design,
      budget_currency: currency,
      budget: index === -1 ? [...budget, next] : budget.map((item, i) => (i === index ? next : item)),
    }
  })
}
