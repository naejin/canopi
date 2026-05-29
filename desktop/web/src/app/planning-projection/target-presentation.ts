import type { BottomPanelTab } from '../canvas-settings/bottom-panel-state'
import {
  clearHoveredPanelTargets,
  clearPanelOriginTargets,
  clearSelectedPanelTargetsForOrigin,
  getCanvasHoveredSpeciesCanonical,
  getSpeciesCanonicalFromTargets,
  panelTargetSelectionMatches,
  prunePanelTargetSelectionForOrigin,
  readPanelTargetSelection,
  setHoveredPanelSpecies,
  setHoveredPanelTargets,
  setSelectedPanelTargets,
  type PanelTargetSelectionSnapshot,
} from '../panel-targets/presentation'

export type PlanningProjectionOrigin = Extract<BottomPanelTab, 'timeline' | 'budget' | 'consortium'>
export type PlanningSelectionSnapshot = PanelTargetSelectionSnapshot

export const readPlanningSelection = readPanelTargetSelection
export const planningTargetsSelected = panelTargetSelectionMatches
export const setPlanningHoveredTargets = setHoveredPanelTargets
export const setPlanningHoveredSpecies = setHoveredPanelSpecies
export const clearPlanningHoveredTargets = clearHoveredPanelTargets
export const setPlanningSelectedTargets = setSelectedPanelTargets
export const clearPlanningSelectedTargetsForOrigin = clearSelectedPanelTargetsForOrigin
export const clearPlanningOriginTargets = clearPanelOriginTargets
export const prunePlanningSelectionForOrigin = prunePanelTargetSelectionForOrigin
export const getPlanningSpeciesCanonicalFromTargets = getSpeciesCanonicalFromTargets
export const getPlanningCanvasHoveredSpeciesCanonical = getCanvasHoveredSpeciesCanonical
