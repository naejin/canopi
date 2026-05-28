import type { BottomPanelTab } from '../canvas-settings/bottom-panel-state'
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from '../panel-targets/state'
import { isSpeciesTarget, panelTargets, speciesTarget } from '../../panel-targets'
import type { PanelTarget } from '../../types/design'

export type PlanningProjectionOrigin = Extract<BottomPanelTab, 'timeline' | 'budget' | 'consortium'>

export interface PlanningSelectionSnapshot {
  readonly origin: BottomPanelTab | null
  readonly targets: readonly PanelTarget[]
  readonly ownsOrigin: boolean
}

export function readPlanningSelection(origin: PlanningProjectionOrigin): PlanningSelectionSnapshot {
  const currentOrigin = selectedPanelTargetOrigin.value
  const targets = selectedPanelTargets.value
  return {
    origin: currentOrigin,
    targets,
    ownsOrigin: currentOrigin === origin && targets.length > 0,
  }
}

export function planningTargetsSelected(
  selection: PlanningSelectionSnapshot,
  targets: readonly PanelTarget[],
): boolean {
  return selection.ownsOrigin && panelTargets.listEquals(selection.targets, targets)
}

export function setPlanningHoveredTargets(targets: readonly PanelTarget[]): void {
  if (!panelTargets.listEquals(hoveredPanelTargets.peek(), targets)) {
    hoveredPanelTargets.value = targets
  }
}

export function setPlanningHoveredSpecies(canonicalName: string): void {
  setPlanningHoveredTargets([speciesTarget(canonicalName)])
}

export function clearPlanningHoveredTargets(): void {
  if (hoveredPanelTargets.peek().length > 0) {
    hoveredPanelTargets.value = []
  }
}

export function setPlanningSelectedTargets(
  origin: PlanningProjectionOrigin,
  targets: readonly PanelTarget[],
): void {
  if (!panelTargets.listEquals(selectedPanelTargets.peek(), targets)) {
    selectedPanelTargets.value = targets
  }
  selectedPanelTargetOrigin.value = targets.length > 0 ? origin : null
}

export function clearPlanningSelectedTargetsForOrigin(origin: PlanningProjectionOrigin): void {
  if (selectedPanelTargetOrigin.peek() !== origin) return
  if (selectedPanelTargets.peek().length > 0) {
    selectedPanelTargets.value = []
  }
  selectedPanelTargetOrigin.value = null
}

export function clearPlanningOriginTargets(): void {
  clearPlanningHoveredTargets()
  if (selectedPanelTargets.peek().length > 0) {
    selectedPanelTargets.value = []
  }
  if (selectedPanelTargetOrigin.peek() !== null) {
    selectedPanelTargetOrigin.value = null
  }
}

export function prunePlanningSelectionForOrigin(
  origin: PlanningProjectionOrigin,
  visibleTargetLists: readonly (readonly PanelTarget[])[],
): void {
  if (selectedPanelTargetOrigin.peek() !== origin) return
  const selected = selectedPanelTargets.peek()
  if (selected.length === 0) {
    selectedPanelTargetOrigin.value = null
    return
  }
  if (visibleTargetLists.some((targets) => panelTargets.listEquals(selected, targets))) return
  clearPlanningSelectedTargetsForOrigin(origin)
}

export function getPlanningSpeciesCanonicalFromTargets(
  targets: readonly PanelTarget[],
): string | null {
  for (const target of targets) {
    if (isSpeciesTarget(target)) return target.canonical_name
  }
  return null
}

export function getPlanningCanvasHoveredSpeciesCanonical(): string | null {
  return getPlanningSpeciesCanonicalFromTargets(hoveredCanvasTargets.value)
}
