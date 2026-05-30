import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
  clearPlanningHoveredTargets,
  clearPlanningSelectedTargetsForOrigin,
  planningTargetsSelected,
  prunePlanningSelectionForOrigin,
  readPlanningSelection,
  setPlanningHoveredTargets,
  setPlanningSelectedTargets,
  useBudgetPlanningSurface,
  type BudgetPlanningProjection,
  type BudgetPlanningRow,
} from '../planning-projection'
import { exportBudgetCsv, isBudgetExportCancelled } from './export'
import { formatBudgetCurrency } from './formatting'
import { setBudgetCurrency, setPlantBudgetPrice } from './controller'

export interface BudgetItemWorkbench {
  readonly projection: BudgetPlanningProjection
  readonly currency: string
  readonly activeLocale: string
  readonly editingCanonical: string | null
  readonly editPrice: string
  readonly setEditPrice: (value: string) => void
  readonly clearHover: () => void
  readonly hoverRow: (row: BudgetPlanningRow) => void
  readonly selectRow: (row: BudgetPlanningRow) => void
  readonly isRowSelected: (row: BudgetPlanningRow) => boolean
  readonly setCurrency: (currency: string) => void
  readonly startPriceEdit: (canonical: string) => void
  readonly commitPriceEdit: (canonical: string) => void
  readonly cancelPriceEdit: () => void
  readonly formatCurrency: (amount: number) => string
  readonly exportCsv: () => Promise<void>
}

export function parseBudgetPriceDraft(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export function budgetPriceDraftValue(price: number | null | undefined): string {
  return price == null ? '' : String(price)
}

export function useBudgetItemWorkbench(): BudgetItemWorkbench {
  const {
    projection,
    currency,
    designName,
    activeLocale,
  } = useBudgetPlanningSurface()
  const editingCanonical = useSignal<string | null>(null)
  const editPrice = useSignal('')
  const projectionRef = useRef(projection)
  projectionRef.current = projection

  const selection = readPlanningSelection('budget')
  const visibleTargetLists = useMemo(
    () => projection.rows.map((row) => [row.target]),
    [projection.rows],
  )

  useEffect(() => clearPlanningHoveredTargets, [])
  useEffect(() => () => clearPlanningSelectedTargetsForOrigin('budget'), [])
  useEffect(() => {
    prunePlanningSelectionForOrigin('budget', visibleTargetLists)
  }, [visibleTargetLists, selection.targets, selection.ownsOrigin])

  const clearHover = useCallback(() => {
    clearPlanningHoveredTargets()
  }, [])

  const hoverRow = useCallback((row: BudgetPlanningRow) => {
    setPlanningHoveredTargets([row.target])
  }, [])

  const selectRow = useCallback((row: BudgetPlanningRow) => {
    setPlanningSelectedTargets('budget', [row.target])
  }, [])

  const isRowSelected = useCallback((row: BudgetPlanningRow) => (
    planningTargetsSelected(selection, [row.target])
  ), [selection])

  const startPriceEdit = useCallback((canonical: string) => {
    const existing = projectionRef.current.lineItemPriceMap.get(canonical)
    editPrice.value = budgetPriceDraftValue(existing?.unit_cost)
    editingCanonical.value = canonical
  }, [editPrice, editingCanonical])

  const commitPriceEdit = useCallback((canonical: string) => {
    if (editingCanonical.value !== canonical) return
    const parsed = parseBudgetPriceDraft(editPrice.value)
    if (parsed !== null) setPlantBudgetPrice(canonical, parsed)
    editingCanonical.value = null
  }, [editPrice, editingCanonical])

  const cancelPriceEdit = useCallback(() => {
    editingCanonical.value = null
  }, [editingCanonical])

  const setEditPrice = useCallback((value: string) => {
    editPrice.value = value
  }, [editPrice])

  const formatCurrency = useCallback((amount: number) => (
    formatBudgetCurrency(amount, currency, activeLocale)
  ), [activeLocale, currency])

  const exportCsv = useCallback(async () => {
    try {
      await exportBudgetCsv(projection.rows, {
        currency,
        designName,
        lineItemPriceMap: projection.lineItemPriceMap,
        grandTotal: projection.grandTotal,
      })
    } catch (error) {
      if (isBudgetExportCancelled(error)) return
      console.error('Budget export failed:', error)
    }
  }, [currency, designName, projection])

  return {
    projection,
    currency,
    activeLocale,
    editingCanonical: editingCanonical.value,
    editPrice: editPrice.value,
    setEditPrice,
    clearHover,
    hoverRow,
    selectRow,
    isRowSelected,
    setCurrency: setBudgetCurrency,
    startPriceEdit,
    commitPriceEdit,
    cancelPriceEdit,
    formatCurrency,
    exportCsv,
  }
}
