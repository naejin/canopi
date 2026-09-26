import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
  buildBudgetListProjection,
  useBudgetPlanningSurface,
  type BudgetListProjection,
  type BudgetPlanningProjection,
  type BudgetPlanningRow,
} from '../planning-projection'
import { createPanelTargetPresentationController } from '../panel-targets/presentation'
import { setBudgetCurrency, setPlantBudgetPrice } from '../design-edit'
import { designSessionStore } from '../document-session/store'
import { usePlanningViewState, type BudgetPriceFilter, type BudgetSort } from '../planning-view/state'
import { currentCanvasQuerySurface, currentCanvasSpeciesFocusCommands } from '../../canvas/session'
import { exportBudgetCsv, isBudgetExportCancelled } from './export'
import { formatBudgetCurrency } from './formatting'

const budgetTargetPresentation = createPanelTargetPresentationController('budget')

export interface BudgetItemWorkbench {
  readonly projection: BudgetPlanningProjection
  readonly list: BudgetListProjection
  readonly currency: string
  readonly activeLocale: string
  readonly search: string
  readonly sort: BudgetSort
  readonly priceFilter: BudgetPriceFilter
  readonly editingCanonical: string | null
  readonly editPrice: string
  readonly priceInvalid: boolean
  readonly exportPending: boolean
  readonly exportFailed: boolean
  readonly focusedCanonical: string | null
  readonly scrollTop: number
  readonly setSearch: (value: string) => void
  readonly setSort: (value: BudgetSort) => void
  readonly setPriceFilter: (value: BudgetPriceFilter) => void
  readonly setScrollTop: (value: number) => void
  readonly setEditPrice: (value: string) => void
  readonly clearHover: () => void
  readonly hoverRow: (row: BudgetPlanningRow) => void
  readonly toggleSpeciesFocus: (canonical: string) => void
  readonly setCurrency: (currency: string) => void
  readonly startPriceEdit: (canonical: string) => void
  readonly commitPriceEdit: (canonical: string, advance?: boolean) => boolean
  readonly cancelPriceEdit: () => void
  readonly formatCurrency: (amount: number) => string
  readonly exportCsv: () => Promise<void>
}

export type BudgetPriceDraftResult =
  | { readonly valid: true; readonly value: number }
  | { readonly valid: false }

export function validateBudgetPriceDraft(value: string): BudgetPriceDraftResult {
  const trimmed = value.trim()
  if (trimmed === '') return { valid: false }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return { valid: false }
  return { valid: true, value: parsed }
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
  const view = usePlanningViewState()
  const sessionIdentity = designSessionStore.sessionIdentity.value
  const search = view.budgetSearch.value
  const sort = view.budgetSort.value
  const priceFilter = view.budgetPriceFilter.value
  const editingCanonical = useSignal<string | null>(null)
  const editPrice = useSignal('')
  const priceInvalid = useSignal(false)
  const exportPending = useSignal(false)
  const exportFailed = useSignal(false)
  const editingIdentityRef = useRef<object | null>(null)
  const exportEpochRef = useRef(0)
  const projectionRef = useRef(projection)
  const list = useMemo(() => buildBudgetListProjection(projection, {
    search,
    sort,
    priceFilter,
    locale: activeLocale,
  }), [activeLocale, priceFilter, projection, search, sort])
  const listRef = useRef(list)
  projectionRef.current = projection
  listRef.current = list

  useEffect(() => () => {
    exportEpochRef.current += 1
    budgetTargetPresentation.dispose()
  }, [])
  useEffect(() => {
    if (
      editingCanonical.value !== null
      && (
        editingIdentityRef.current !== sessionIdentity
        || !projection.rows.some((row) => row.canonical === editingCanonical.value)
      )
    ) {
      editingCanonical.value = null
      editingIdentityRef.current = null
      priceInvalid.value = false
    }
  }, [editingCanonical, priceInvalid, projection.rows, sessionIdentity])

  const clearHover = useCallback(() => {
    budgetTargetPresentation.clearHoveredTargets()
  }, [])

  const hoverRow = useCallback((row: BudgetPlanningRow) => {
    budgetTargetPresentation.setHoveredTargets([row.target])
  }, [])

  const toggleSpeciesFocus = useCallback((canonical: string) => {
    const queries = currentCanvasQuerySurface.peek()
    const commands = currentCanvasSpeciesFocusCommands.peek()
    if (!queries || !commands) return
    commands.focus(queries.getSpeciesFocus().canonicalName === canonical ? null : canonical)
  }, [])

  const startPriceEdit = useCallback((canonical: string) => {
    const existing = projectionRef.current.lineItemPriceMap.get(canonical)
    editPrice.value = budgetPriceDraftValue(existing?.unit_cost)
    priceInvalid.value = false
    editingIdentityRef.current = designSessionStore.sessionIdentity.peek()
    editingCanonical.value = canonical
  }, [editPrice, editingCanonical, priceInvalid])

  const commitPriceEdit = useCallback((canonical: string, advance = false): boolean => {
    // A replaced input may emit blur after Enter has already advanced the editor.
    // Ignore that stale event without cancelling the next row's active draft.
    if (editingCanonical.value !== canonical) return false
    if (
      editingIdentityRef.current !== designSessionStore.sessionIdentity.peek()
      || !projectionRef.current.rows.some((row) => row.canonical === canonical)
    ) {
      editingCanonical.value = null
      editingIdentityRef.current = null
      return false
    }
    const parsed = validateBudgetPriceDraft(editPrice.value)
    if (!parsed.valid) {
      priceInvalid.value = true
      return false
    }

    setPlantBudgetPrice(canonical, parsed.value)
    priceInvalid.value = false
    if (advance) {
      const rows = listRef.current.rows
      const next = rows[rows.findIndex((row) => row.canonical === canonical) + 1]
      if (next) {
        const existing = projectionRef.current.lineItemPriceMap.get(next.canonical)
        editPrice.value = budgetPriceDraftValue(existing?.unit_cost)
        editingCanonical.value = next.canonical
        return true
      }
    }
    editingCanonical.value = null
    editingIdentityRef.current = null
    return true
  }, [editPrice, editingCanonical, priceInvalid])

  const cancelPriceEdit = useCallback(() => {
    editingCanonical.value = null
    editingIdentityRef.current = null
    priceInvalid.value = false
  }, [editingCanonical, priceInvalid])

  const setEditPrice = useCallback((value: string) => {
    editPrice.value = value
    priceInvalid.value = !validateBudgetPriceDraft(value).valid
  }, [editPrice, priceInvalid])

  const formatCurrency = useCallback((amount: number) => (
    formatBudgetCurrency(amount, currency, activeLocale)
  ), [activeLocale, currency])

  const exportCsv = useCallback(async () => {
    const request = ++exportEpochRef.current
    const identity = designSessionStore.sessionIdentity.peek()
    exportFailed.value = false
    exportPending.value = true
    try {
      await exportBudgetCsv(projection.rows, {
        currency,
        designName,
        lineItemPriceMap: projection.lineItemPriceMap,
        grandTotal: projection.grandTotal,
      })
      if (
        request === exportEpochRef.current
        && identity === designSessionStore.sessionIdentity.peek()
      ) exportPending.value = false
    } catch (error) {
      if (
        request !== exportEpochRef.current
        || identity !== designSessionStore.sessionIdentity.peek()
      ) return
      exportPending.value = false
      if (isBudgetExportCancelled(error)) return
      exportFailed.value = true
      console.error('Budget export failed:', error)
    }
  }, [currency, designName, exportFailed, exportPending, projection])

  return {
    projection,
    list,
    currency,
    activeLocale,
    search,
    sort,
    priceFilter,
    editingCanonical: editingCanonical.value,
    editPrice: editPrice.value,
    priceInvalid: priceInvalid.value,
    exportPending: exportPending.value,
    exportFailed: exportFailed.value,
    focusedCanonical: currentCanvasQuerySurface.value?.getSpeciesFocus().canonicalName ?? null,
    scrollTop: view.budgetScrollTop,
    setSearch: (value) => { view.budgetSearch.value = value },
    setSort: (value) => { view.budgetSort.value = value },
    setPriceFilter: (value) => { view.budgetPriceFilter.value = value },
    setScrollTop: (value) => { view.budgetScrollTop = value },
    setEditPrice,
    clearHover,
    hoverRow,
    toggleSpeciesFocus,
    setCurrency: setBudgetCurrency,
    startPriceEdit,
    commitPriceEdit,
    cancelPriceEdit,
    formatCurrency,
    exportCsv,
  }
}
