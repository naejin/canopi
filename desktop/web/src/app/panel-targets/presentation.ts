import { effect } from '@preact/signals'
import type { BottomPanelTab } from '../canvas-settings/bottom-panel-state'
import { isSpeciesTarget, targetIdentity, speciesTarget } from '../../target'
import type { PanelTarget } from '../../types/design'
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from './state'

export type PanelTargetPresentationOrigin = BottomPanelTab
export type TargetPresentationOrigin = PanelTargetPresentationOrigin

export interface PanelTargetSelectionSnapshot {
  readonly origin: BottomPanelTab | null
  readonly targets: readonly PanelTarget[]
  readonly ownsOrigin: boolean
}

export interface PanelTargetPresentationController {
  readonly origin: PanelTargetPresentationOrigin
  readSelection(): PanelTargetSelectionSnapshot
  selectionMatches(
    selection: PanelTargetSelectionSnapshot,
    targetList: readonly PanelTarget[],
  ): boolean
  setHoveredTargets(targetList: readonly PanelTarget[]): void
  setHoveredSpecies(canonicalName: string): void
  clearHoveredTargets(): void
  setSelectedTargets(targetList: readonly PanelTarget[]): void
  clearSelectedTargets(): void
  pruneSelection(visibleTargetLists: readonly (readonly PanelTarget[])[]): void
  readCanvasHoveredSpeciesCanonical(): string | null
  dispose(): void
}

export interface PanelTargetOverlaySnapshot {
  readonly hoveredTargets: readonly PanelTarget[]
  readonly selectedTargets: readonly PanelTarget[]
}

export function readPanelTargetSelection(
  origin: PanelTargetPresentationOrigin,
): PanelTargetSelectionSnapshot {
  const currentOrigin = selectedPanelTargetOrigin.value
  const targets = selectedPanelTargets.value
  return {
    origin: currentOrigin,
    targets,
    ownsOrigin: currentOrigin === origin && targets.length > 0,
  }
}

export function panelTargetSelectionMatches(
  selection: PanelTargetSelectionSnapshot,
  targetList: readonly PanelTarget[],
): boolean {
  return selection.ownsOrigin && targetIdentity.listEquals(selection.targets, targetList)
}

export function createPanelTargetPresentationController(
  origin: PanelTargetPresentationOrigin,
): PanelTargetPresentationController {
  return {
    origin,

    readSelection() {
      return readPanelTargetSelection(origin)
    },

    selectionMatches(selection, targetList) {
      return panelTargetSelectionMatches(selection, targetList)
    },

    setHoveredTargets(targetList) {
      setHoveredPanelTargets(targetList)
    },

    setHoveredSpecies(canonicalName) {
      setHoveredPanelSpecies(canonicalName)
    },

    clearHoveredTargets() {
      clearHoveredPanelTargets()
    },

    setSelectedTargets(targetList) {
      setSelectedPanelTargets(origin, targetList)
    },

    clearSelectedTargets() {
      clearSelectedPanelTargetsForOrigin(origin)
    },

    pruneSelection(visibleTargetLists) {
      prunePanelTargetSelectionForOrigin(origin, visibleTargetLists)
    },

    readCanvasHoveredSpeciesCanonical() {
      return getCanvasHoveredSpeciesCanonical()
    },

    dispose() {
      clearHoveredPanelTargets()
      clearSelectedPanelTargetsForOrigin(origin)
    },
  }
}

export function setHoveredPanelTargets(targetList: readonly PanelTarget[]): void {
  if (!targetIdentity.listEquals(hoveredPanelTargets.peek(), targetList)) {
    hoveredPanelTargets.value = targetList
  }
}

export function setHoveredPanelSpecies(canonicalName: string): void {
  setHoveredPanelTargets([speciesTarget(canonicalName)])
}

export function clearHoveredPanelTargets(): void {
  if (hoveredPanelTargets.peek().length > 0) {
    hoveredPanelTargets.value = []
  }
}

export function setSelectedPanelTargets(
  origin: PanelTargetPresentationOrigin,
  targetList: readonly PanelTarget[],
): void {
  if (!targetIdentity.listEquals(selectedPanelTargets.peek(), targetList)) {
    selectedPanelTargets.value = targetList
  }
  selectedPanelTargetOrigin.value = targetList.length > 0 ? origin : null
}

export function clearSelectedPanelTargetsForOrigin(
  origin: PanelTargetPresentationOrigin,
): void {
  if (selectedPanelTargetOrigin.peek() !== origin) return
  if (selectedPanelTargets.peek().length > 0) {
    selectedPanelTargets.value = []
  }
  selectedPanelTargetOrigin.value = null
}

export function clearPanelOriginTargets(): void {
  clearHoveredPanelTargets()
  if (selectedPanelTargets.peek().length > 0) {
    selectedPanelTargets.value = []
  }
  if (selectedPanelTargetOrigin.peek() !== null) {
    selectedPanelTargetOrigin.value = null
  }
}

export function prunePanelTargetSelectionForOrigin(
  origin: PanelTargetPresentationOrigin,
  visibleTargetLists: readonly (readonly PanelTarget[])[],
): void {
  if (selectedPanelTargetOrigin.peek() !== origin) return
  const selected = selectedPanelTargets.peek()
  if (selected.length === 0) {
    selectedPanelTargetOrigin.value = null
    return
  }
  if (visibleTargetLists.some((targetList) => targetIdentity.listEquals(selected, targetList))) return
  clearSelectedPanelTargetsForOrigin(origin)
}

export function getSpeciesCanonicalFromTargets(
  targets: readonly PanelTarget[],
): string | null {
  for (const target of targets) {
    if (isSpeciesTarget(target)) return target.canonical_name
  }
  return null
}

export function getCanvasHoveredSpeciesCanonical(): string | null {
  return getSpeciesCanonicalFromTargets(hoveredCanvasTargets.value)
}

export function setCanvasHoveredTargets(targetList: readonly PanelTarget[]): void {
  if (!targetIdentity.listEquals(hoveredCanvasTargets.peek(), targetList)) {
    hoveredCanvasTargets.value = targetList
  }
}

export function readPanelOriginTargets(): readonly PanelTarget[] {
  return [
    ...selectedPanelTargets.value,
    ...hoveredPanelTargets.value,
  ]
}

export function readPanelTargetOverlaySnapshot(): PanelTargetOverlaySnapshot {
  return {
    hoveredTargets: hoveredPanelTargets.value,
    selectedTargets: selectedPanelTargets.value,
  }
}

export function subscribePanelOriginTargetChanges(
  onChange: () => void,
): () => void {
  return effect(() => {
    void hoveredPanelTargets.value
    void selectedPanelTargets.value
    onChange()
  })
}
