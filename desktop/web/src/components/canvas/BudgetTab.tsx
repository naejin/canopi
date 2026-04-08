import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { sceneEntityRevision, plantNamesRevision, hoveredPanelTargets, selectedPanelTargetOrigin, selectedPanelTargets } from '../../state/canvas'
import { currentDesign, designName } from '../../state/document'
import { currentCanvasSession } from '../../canvas/session'
import { exportFile } from '../../ipc/design'
import { setPlantBudgetPrice, setBudgetCurrency } from '../../state/budget-actions'
import { Dropdown } from '../shared/Dropdown'
import { CURRENCY_ITEMS } from './budget-currencies'
import { countPlants, buildPriceMap, formatCurrency, escapeCsvField } from './budget-helpers'
import { getBudgetHoverTarget, getBudgetSpeciesTarget, panelTargetsEqual } from '../../panel-targets'
import type { BudgetItem, PanelTarget, PlacedPlant } from '../../types/design'
import styles from './BudgetTab.module.css'

const EMPTY_BUDGET: BudgetItem[] = []
const EMPTY_PLANTS: PlacedPlant[] = []
const EMPTY_NAMES: ReadonlyMap<string, string | null> = new Map()
const EMPTY_PANEL_TARGETS: readonly PanelTarget[] = []

function setBudgetHoveredPanelTargets(targets: readonly PanelTarget[]): void {
  if (!panelTargetsEqual(hoveredPanelTargets.peek(), targets)) {
    hoveredPanelTargets.value = targets
  }
}

function setBudgetSelectedPanelTargets(targets: readonly PanelTarget[]): void {
  if (!panelTargetsEqual(selectedPanelTargets.peek(), targets)) {
    selectedPanelTargets.value = targets
  }
  selectedPanelTargetOrigin.value = targets.length > 0 ? 'budget' : null
}

function clearBudgetSelectedPanelTargets(): void {
  if (selectedPanelTargetOrigin.peek() !== 'budget') return
  if (selectedPanelTargets.peek().length > 0) selectedPanelTargets.value = []
  selectedPanelTargetOrigin.value = null
}

export function BudgetTab() {
  const session = currentCanvasSession.value

  const editingCanonical = useSignal<string | null>(null)
  const editPrice = useSignal('')

  const design = currentDesign.value
  const budget = design?.budget ?? EMPTY_BUDGET
  const currency = design?.budget_currency ?? 'EUR'
  const plants = session?.getPlacedPlants() ?? EMPTY_PLANTS
  const localizedNames = session?.getLocalizedCommonNames() ?? EMPTY_NAMES
  // Store in refs — getPlacedPlants()/getLocalizedCommonNames() return fresh references
  // every call. Use sceneEntityRevision/plantNamesRevision as the real change triggers.
  const plantsRef = useRef(plants)
  plantsRef.current = plants
  const localizedNamesRef = useRef(localizedNames)
  localizedNamesRef.current = localizedNames
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groupedPlants = useMemo(() => countPlants(plantsRef.current, localizedNamesRef.current, locale.value), [sceneEntityRevision.value, plantNamesRevision.value, locale.value])
  const priceMap = useMemo(() => buildPriceMap(budget), [budget])
  const budgetItemMap = useMemo(() => {
    const map = new Map<string, BudgetItem>()
    for (const item of budget) {
      const target = getBudgetSpeciesTarget(item)
      if (target) map.set(target.canonical_name, item)
    }
    return map
  }, [budget])
  const totalPlants = useMemo(() => groupedPlants.reduce((sum, row) => sum + row.count, 0), [groupedPlants])
  const pricedCount = useMemo(() => groupedPlants.filter((row) => (priceMap.get(row.canonical)?.unit_cost ?? 0) > 0).length, [groupedPlants, priceMap])
  const grandTotal = useMemo(() => groupedPlants.reduce((total, row) => {
    const entry = priceMap.get(row.canonical)
    return total + row.count * (entry?.unit_cost ?? 0)
  }, 0), [groupedPlants, priceMap])

  const priceMapRef = useRef(priceMap)
  priceMapRef.current = priceMap
  const selectedTargets = selectedPanelTargets.value
  const selectedOrigin = selectedPanelTargetOrigin.value

  const startEditPrice = useCallback((canonical: string) => {
    editPrice.value = String(priceMapRef.current.get(canonical)?.unit_cost ?? '')
    editingCanonical.value = canonical
  }, [])

  const commitPrice = useCallback((canonical: string) => {
    if (editingCanonical.value !== canonical) return
    setPlantBudgetPrice(canonical, parseFloat(editPrice.value) || 0)
    editingCanonical.value = null
  }, [])

  const handleRowMouseEnter = useCallback((canonical: string) => {
    setBudgetHoveredPanelTargets([getBudgetHoverTarget(budgetItemMap.get(canonical), canonical)])
  }, [budgetItemMap])

  const handleRowClick = useCallback((canonical: string) => {
    setBudgetSelectedPanelTargets([getBudgetHoverTarget(budgetItemMap.get(canonical), canonical)])
  }, [budgetItemMap])

  const clearBudgetHover = useCallback(() => {
    setBudgetHoveredPanelTargets(EMPTY_PANEL_TARGETS)
  }, [])

  useEffect(() => clearBudgetHover, [clearBudgetHover])

  useEffect(() => clearBudgetSelectedPanelTargets, [])

  useEffect(() => {
    if (selectedOrigin !== 'budget' || selectedTargets.length === 0) return
    for (const row of groupedPlants) {
      const target = getBudgetHoverTarget(budgetItemMap.get(row.canonical), row.canonical)
      if (panelTargetsEqual(selectedTargets, [target])) return
    }
    clearBudgetSelectedPanelTargets()
  }, [groupedPlants, budgetItemMap, selectedTargets, selectedOrigin])

  async function handleExportCSV() {
    const header = [t('canvas.budget.species'), t('canvas.budget.quantity'), t('canvas.budget.unitCost'), t('canvas.budget.lineTotal'), t('canvas.budget.currency')].map(escapeCsvField).join(',')
    const rows = [header]
    for (const row of groupedPlants) {
      const entry = priceMap.get(row.canonical)
      const price = entry?.unit_cost ?? 0
      const displayName = row.commonName || row.canonical
      rows.push(`${escapeCsvField(displayName)},${row.count},${price.toFixed(2)},${(row.count * price).toFixed(2)},${currency}`)
    }
    rows.push(`${escapeCsvField(t('canvas.budget.grandTotal'))},,,${grandTotal.toFixed(2)},`)

    try {
      await exportFile(rows.join('\n'), `${designName.value || 'budget'}-budget.csv`, 'CSV', ['csv'])
    } catch {
      // User cancelled export.
    }
  }

  if (groupedPlants.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('canvas.budget.emptyCanvas')}</p>
          <p className={styles.emptyHint}>{t('canvas.budget.emptyHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.summaryStats}>
          {t('canvas.budget.speciesCount', { count: groupedPlants.length })}
          <span className={styles.summaryDot}>{' \u00B7 '}</span>
          {t('canvas.budget.plantCount', { count: totalPlants })}
          <span className={styles.summaryDot}>{' \u00B7 '}</span>
          <span className={pricedCount === groupedPlants.length && pricedCount > 0 ? styles.pricedComplete : undefined}>
            {t('canvas.budget.pricedProgress', { done: pricedCount, total: groupedPlants.length })}
          </span>
        </span>
        <Dropdown
          trigger={currency}
          items={CURRENCY_ITEMS}
          value={currency}
          onChange={setBudgetCurrency}
          menuDirection="down"
          ariaLabel={t('canvas.budget.currencyLabel')}
          triggerClassName={styles.currencyChip}
        />
        <span className={styles.total}>
          {t('canvas.budget.grandTotal')}{' '}{formatCurrency(grandTotal, currency, locale.value)}
        </span>
        <button type="button" className={styles.exportBtn} onClick={handleExportCSV}>
          {t('canvas.budget.exportCSV')}
        </button>
      </div>

      <div className={styles.tableWrapper} onMouseLeave={clearBudgetHover}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thSpecies}>{t('canvas.budget.species')}</th>
              <th className={styles.thNum}>{t('canvas.budget.quantity')}</th>
              <th className={styles.thNum}>{t('canvas.budget.unitCost')}</th>
              <th className={styles.thNum}>{t('canvas.budget.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {groupedPlants.map((row) => {
              const entry = priceMap.get(row.canonical)
              const price = entry?.unit_cost ?? 0
              const subtotal = row.count * price
              const isEditing = editingCanonical.value === row.canonical
              const rowTarget = getBudgetHoverTarget(budgetItemMap.get(row.canonical), row.canonical)
              const isSelected = selectedOrigin === 'budget' && panelTargetsEqual(selectedTargets, [rowTarget])

              return (
                <tr
                  key={row.canonical}
                  className={`${styles.row}${isSelected ? ` ${styles.rowSelected}` : ''}`}
                  onClick={() => handleRowClick(row.canonical)}
                  onMouseEnter={() => handleRowMouseEnter(row.canonical)}
                  onMouseLeave={clearBudgetHover}
                >
                  <td>
                    <div className={styles.tdSpecies}>
                      <span className={styles.commonName}>{row.commonName || row.canonical}</span>
                      {row.commonName && <span className={styles.canonical}>{row.canonical}</span>}
                    </div>
                  </td>
                  <td className={styles.tdNum}>{row.count}</td>
                  <td className={styles.tdNum}>
                    {isEditing ? (
                      <input
                        type="number"
                        className={styles.priceInput}
                        value={editPrice.value}
                        min="0"
                        step="0.01"
                        onInput={(event) => { editPrice.value = (event.target as HTMLInputElement).value }}
                        onBlur={() => commitPrice(row.canonical)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitPrice(row.canonical)
                          if (event.key === 'Escape') editingCanonical.value = null
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className={`${styles.priceBtn}${price === 0 ? ` ${styles.priceEmpty}` : ''}`}
                        onClick={() => startEditPrice(row.canonical)}
                        aria-label={`${t('canvas.budget.setPrice')} ${row.commonName || row.canonical}`}
                      >
                        {price > 0 ? formatCurrency(price, currency, locale.value) : '\u2014'}
                      </button>
                    )}
                  </td>
                  <td className={styles.tdNum}>{price > 0 ? formatCurrency(subtotal, currency, locale.value) : '\u2014'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {pricedCount === 0 && (
          <p className={styles.hint}>{t('canvas.budget.hintSetPrice')}</p>
        )}
      </div>
    </div>
  )
}
