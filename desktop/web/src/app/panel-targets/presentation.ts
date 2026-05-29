import { effect } from '@preact/signals'
import type { BottomPanelTab } from '../canvas-settings/bottom-panel-state'
import { isSpeciesTarget, panelTargets, speciesTarget } from '../../panel-targets'
import type { PanelTarget } from '../../types/design'
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from './state'

export type PanelTargetPresentationOrigin = BottomPanelTab

export interface PanelTargetSelectionSnapshot {
  readonly origin: BottomPanelTab | null
  readonly targets: readonly PanelTarget[]
  readonly ownsOrigin: boolean
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
  targets: readonly PanelTarget[],
): boolean {
  return selection.ownsOrigin && panelTargets.listEquals(selection.targets, targets)
}

export function setHoveredPanelTargets(targets: readonly PanelTarget[]): void {
  if (!panelTargets.listEquals(hoveredPanelTargets.peek(), targets)) {
    hoveredPanelTargets.value = targets
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
  targets: readonly PanelTarget[],
): void {
  if (!panelTargets.listEquals(selectedPanelTargets.peek(), targets)) {
    selectedPanelTargets.value = targets
  }
  selectedPanelTargetOrigin.value = targets.length > 0 ? origin : null
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
  if (visibleTargetLists.some((targets) => panelTargets.listEquals(selected, targets))) return
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

export function setCanvasHoveredTargets(targets: readonly PanelTarget[]): void {
  if (!panelTargets.listEquals(hoveredCanvasTargets.peek(), targets)) {
    hoveredCanvasTargets.value = targets
  }
}

export function readPanelOriginTargets(): readonly PanelTarget[] {
  return [
    ...selectedPanelTargets.value,
    ...hoveredPanelTargets.value,
  ]
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
