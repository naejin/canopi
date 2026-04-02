import { signal, batch } from "@preact/signals";
import type { PlantDbStatus } from "../types/health";
import type { Settings } from "../types/settings";
import { setSettings } from "../ipc/settings";
import { gridSize, snapToGridEnabled } from "./canvas";

export type Panel = "plant-db" | "canvas" | "favorites" | "location";

// Panels that open as a sidebar alongside the canvas instead of replacing it.
export type SidePanel = "plant-db" | "favorites";

const SIDE_PANELS = new Set<Panel>(["plant-db", "favorites"]);

export const activePanel = signal<Panel>("canvas");
export const locale = signal<"en" | "fr" | "es" | "pt" | "it" | "zh" | "de" | "ja" | "ko" | "nl" | "ru">("en");
export const theme = signal<"light" | "dark">("light");
export const dbReady = signal(false);

/** Plant DB subsystem health — queried from Rust on startup. */
export const plantDbStatus = signal<PlantDbStatus>('available');

/** Autosave interval in milliseconds — hydrated from Rust settings on startup. */
export const autoSaveIntervalMs = signal<number>(60_000);

/** Snapshot of the last settings received from Rust, used to build the full
 *  object when persisting a partial change back. */
let _lastSettings: Settings | null = null;

/** Called by app.tsx after bootstrap to store the initial settings snapshot. */
export function setBootstrappedSettings(s: Settings): void {
  _lastSettings = s;
}

/** Persist the current signal values back to Rust. Call after user changes. */
export function persistCurrentSettings(): void {
  if (!_lastSettings) return;
  const updated: Settings = {
    ..._lastSettings,
    locale: locale.value,
    theme: theme.value,
    grid_size_m: gridSize.value,
    snap_to_grid: snapToGridEnabled.value,
    auto_save_interval_s: Math.round(autoSaveIntervalMs.value / 1000),
  };
  _lastSettings = updated;
  setSettings(updated).catch((e) => console.error('Failed to persist settings:', e));
}

// Which sidebar panel is open alongside the canvas. null = none.
// Starts closed — the user opens Plant DB when they need it (by then IPC is ready).
export const sidePanel = signal<SidePanel | null>(null);

// Sidebar width in pixels — user-adjustable via drag handle
export const sidePanelWidth = signal<number>(560);

/**
 * Navigate to a panel using the correct routing model:
 * - plant-db / favorites: open as sidebar alongside canvas (toggle if already open)
 * - canvas / location: full-screen primary panels
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

    // Remaining full-screen panels — close sidebar
    sidePanel.value = null;
    activePanel.value = panel;
  });
}
