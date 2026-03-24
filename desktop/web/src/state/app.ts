import { signal, batch } from "@preact/signals";

export type Panel = "plant-db" | "canvas" | "world-map" | "learning";

// Panels that open as a sidebar alongside the canvas instead of replacing it.
// World map is full-screen only.
export type SidePanel = "plant-db" | "learning";

const SIDE_PANELS = new Set<Panel>(["plant-db", "learning"]);

export const activePanel = signal<Panel>("canvas");
export const locale = signal<"en" | "fr" | "es" | "pt" | "it" | "zh">("en");
export const theme = signal<"light" | "dark" | "system">("system");
export const dbReady = signal(false);

// Which sidebar panel is open alongside the canvas. null = none.
// Starts closed — the user opens Plant DB when they need it (by then IPC is ready).
export const sidePanel = signal<SidePanel | null>(null);

// Sidebar width in pixels — user-adjustable via drag handle
export const sidePanelWidth = signal<number>(560);

/**
 * Navigate to a panel using the correct routing model:
 * - plant-db / learning: open as sidebar alongside canvas (toggle if already open)
 * - canvas: close any sidebar, show canvas only
 * - world-map: full-screen, close sidebar
 */
export function navigateTo(panel: Panel): void {
  batch(() => {
    if (SIDE_PANELS.has(panel)) {
      // Side panels toggle alongside canvas — don't close saved designs
      const p = panel as SidePanel;
      if (sidePanel.value === p) {
        sidePanel.value = null;
      } else {
        sidePanel.value = p;
        activePanel.value = "canvas";
      }
      return;
    }

    if (panel === "canvas") {
      sidePanel.value = null;
      activePanel.value = "canvas";
      return;
    }

    // Full-screen panels (world-map) — close sidebar
    sidePanel.value = null;
    activePanel.value = panel;
  });
}
