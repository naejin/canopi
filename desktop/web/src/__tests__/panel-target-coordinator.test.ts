import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHoveredPanelTargets,
  clearPanelOriginTargets,
  clearSelectedPanelTargetsForOrigin,
  readPanelOriginTargets,
  setCanvasHoveredTargets,
  setHoveredPanelTargets,
  setSelectedPanelTargets,
} from "../app/panel-targets/presentation";
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from "../app/panel-targets/state";
import { speciesTarget } from "../target";

describe("Target Presentation", () => {
  beforeEach(() => {
    hoveredPanelTargets.value = [];
    hoveredCanvasTargets.value = [];
    selectedPanelTargets.value = [];
    selectedPanelTargetOrigin.value = null;
  });

  it("deduplicates repeated hover writes", () => {
    const targets = [speciesTarget("Malus domestica")];

    setHoveredPanelTargets(targets);
    const firstRef = hoveredPanelTargets.value;
    setHoveredPanelTargets(targets);

    expect(hoveredPanelTargets.value).toEqual(targets);
    expect(hoveredPanelTargets.value).toBe(firstRef);

    clearHoveredPanelTargets();
    expect(hoveredPanelTargets.value).toEqual([]);
  });

  it("clears selected targets only for the owning origin", () => {
    const targets = [speciesTarget("Malus domestica")];

    setSelectedPanelTargets("timeline", targets);
    clearSelectedPanelTargetsForOrigin("budget");

    expect(selectedPanelTargets.value).toEqual(targets);
    expect(selectedPanelTargetOrigin.value).toBe("timeline");

    clearSelectedPanelTargetsForOrigin("timeline");

    expect(selectedPanelTargets.value).toEqual([]);
    expect(selectedPanelTargetOrigin.value).toBe(null);
  });

  it("clears all panel-origin bridge state on teardown", () => {
    hoveredPanelTargets.value = [speciesTarget("Hovered")];
    setSelectedPanelTargets("budget", [speciesTarget("Selected")]);

    clearPanelOriginTargets();

    expect(hoveredPanelTargets.value).toEqual([]);
    expect(selectedPanelTargets.value).toEqual([]);
    expect(selectedPanelTargetOrigin.value).toBe(null);
  });

  it("keeps panel-origin and canvas-origin target state behind the presentation seam", () => {
    const selected = speciesTarget("Selected");
    const hovered = speciesTarget("Hovered");
    const canvasHovered = speciesTarget("Canvas hovered");

    setSelectedPanelTargets("timeline", [selected]);
    setHoveredPanelTargets([hovered]);
    setCanvasHoveredTargets([canvasHovered]);

    expect(readPanelOriginTargets()).toEqual([selected, hovered]);
    expect(hoveredCanvasTargets.value).toEqual([canvasHovered]);
  });
});
