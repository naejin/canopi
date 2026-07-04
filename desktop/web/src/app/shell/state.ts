import { signal, batch } from "@preact/signals";

export type Panel = "plant-db" | "canvas" | "favorites" | "location" | "templates" | "design-notebook";

// Panels that open as a sidebar alongside the canvas instead of replacing it.
export type SidePanel = "plant-db" | "favorites" | "design-notebook";

const SIDE_PANELS = new Set<Panel>(["plant-db", "favorites", "design-notebook"]);

export const activePanel = signal<Panel>("canvas");

// Which sidebar panel is open alongside the canvas. null = none.
// Starts closed — the user opens the Species Catalog Workbench when they need it
// (by then IPC is ready).
export const sidePanel = signal<SidePanel | null>(null);

// Sidebar width in pixels. null = no explicit user resize, so the shell uses
// the responsive first-use default.
export const sidePanelWidth = signal<number | null>(null);

/**
 * Navigate to a panel using the correct routing model:
 * - plant-db / favorites: open as sidebar alongside canvas (toggle if already open)
 * - canvas / location / templates: full-screen primary panels
 */
export function navigateTo(panel: Panel): void {
  batch(() => {
    if (SIDE_PANELS.has(panel)) {
      const nextSidePanel = panel as SidePanel;
      if (sidePanel.value === nextSidePanel) {
        sidePanel.value = null;
      } else {
        sidePanel.value = nextSidePanel;
        activePanel.value = "canvas";
      }
      return;
    }

    if (panel === "canvas") {
      sidePanel.value = null;
      activePanel.value = "canvas";
      return;
    }

    sidePanel.value = null;
    activePanel.value = panel;
  });
}
