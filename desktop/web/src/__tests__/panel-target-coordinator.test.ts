import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHoveredPanelTargets,
  clearPanelOriginTargets,
  clearSelectedPanelTargetsForOrigin,
  setHoveredPanelTargets,
  setSelectedPanelTargets,
} from "../app/panel-targets/coordinator";
import {
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from "../state/canvas";
import { speciesTarget } from "../panel-targets";

describe("panel target coordinator", () => {
  beforeEach(() => {
    hoveredPanelTargets.value = [];
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
});
