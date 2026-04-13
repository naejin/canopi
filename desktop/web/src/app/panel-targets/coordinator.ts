import {
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from "./state";
import type { BottomPanelTab } from "../../state/canvas";
import { panelTargetsEqual } from "../../panel-targets";
import type { PanelTarget } from "../../types/design";

export function setHoveredPanelTargets(targets: readonly PanelTarget[]): void {
  if (!panelTargetsEqual(hoveredPanelTargets.peek(), targets)) {
    hoveredPanelTargets.value = targets;
  }
}

export function clearHoveredPanelTargets(): void {
  if (hoveredPanelTargets.peek().length > 0) {
    hoveredPanelTargets.value = [];
  }
}

export function setSelectedPanelTargets(
  origin: BottomPanelTab,
  targets: readonly PanelTarget[],
): void {
  if (!panelTargetsEqual(selectedPanelTargets.peek(), targets)) {
    selectedPanelTargets.value = targets;
  }
  selectedPanelTargetOrigin.value = targets.length > 0 ? origin : null;
}

export function clearSelectedPanelTargetsForOrigin(origin: BottomPanelTab): void {
  if (selectedPanelTargetOrigin.peek() !== origin) return;
  if (selectedPanelTargets.peek().length > 0) {
    selectedPanelTargets.value = [];
  }
  selectedPanelTargetOrigin.value = null;
}

export function clearPanelOriginTargets(): void {
  clearHoveredPanelTargets();
  if (selectedPanelTargets.peek().length > 0) {
    selectedPanelTargets.value = [];
  }
  if (selectedPanelTargetOrigin.value !== null) {
    selectedPanelTargetOrigin.value = null;
  }
}
