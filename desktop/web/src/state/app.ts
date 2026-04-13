import { signal, batch } from "@preact/signals";
import type { PlantDbStatus } from "../types/health";
import type { Settings } from "../types/settings";
import { setSettings } from "../ipc/settings";
import {
  VISIBLE_BOTTOM_PANEL_TABS,
  bottomPanelHeight,
  bottomPanelOpen,
  bottomPanelTab,
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
  snapToGridEnabled,
  snapToGuidesEnabled,
} from "./canvas";

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
let _queuedPersistTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

function clampUnitInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function normalizeContourInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

/** Called by app.tsx after bootstrap to hydrate signals and store the settings snapshot. */
export function setBootstrappedSettings(s: Settings): void {
  batch(() => {
    locale.value = s.locale;
    theme.value = s.theme === "dark" ? "dark" : "light";
    snapToGridEnabled.value = s.snap_to_grid;
    snapToGuidesEnabled.value = s.snap_to_guides;
    autoSaveIntervalMs.value = s.auto_save_interval_s * 1000;
    bottomPanelOpen.value = s.bottom_panel_open;
    bottomPanelHeight.value = s.bottom_panel_height;
    if (VISIBLE_BOTTOM_PANEL_TABS.includes(s.bottom_panel_tab as typeof bottomPanelTab.value)) {
      bottomPanelTab.value = s.bottom_panel_tab as typeof bottomPanelTab.value;
    }
    layerVisibility.value = {
      ...layerVisibility.value,
      base: s.map_layer_visible,
      contours: s.contour_visible,
    };
    layerOpacity.value = {
      ...layerOpacity.value,
      base: clampUnitInterval(s.map_opacity, 1),
      contours: clampUnitInterval(s.contour_opacity, 1),
    };
    contourIntervalMeters.value = normalizeContourInterval(s.contour_interval, 0);
    hillshadeVisible.value = s.hillshade_visible;
    hillshadeOpacity.value = clampUnitInterval(s.hillshade_opacity, 0.55);
  });
  _lastSettings = s;
}

/** Persist the current signal values back to Rust. Call after user changes. */
export function persistCurrentSettings(): void {
  if (!_lastSettings) return;
  if (_queuedPersistTimer !== null) {
    globalThis.clearTimeout(_queuedPersistTimer);
    _queuedPersistTimer = null;
  }
  const updated: Settings = {
    ..._lastSettings,
    locale: locale.value,
    theme: theme.value,
    snap_to_grid: snapToGridEnabled.value,
    snap_to_guides: snapToGuidesEnabled.value,
    auto_save_interval_s: Math.round(autoSaveIntervalMs.value / 1000),
    bottom_panel_open: bottomPanelOpen.value,
    bottom_panel_height: bottomPanelHeight.value,
    bottom_panel_tab: bottomPanelTab.value,
    map_layer_visible: layerVisibility.value.base ?? true,
    map_opacity: clampUnitInterval(layerOpacity.value.base ?? 1, 1),
    contour_visible: layerVisibility.value.contours ?? false,
    contour_opacity: clampUnitInterval(layerOpacity.value.contours ?? 1, 1),
    contour_interval: normalizeContourInterval(contourIntervalMeters.value, 0),
    hillshade_visible: hillshadeVisible.value,
    hillshade_opacity: clampUnitInterval(hillshadeOpacity.value, 0.55),
  };
  _lastSettings = updated;
  setSettings(updated).catch((e) => console.error('Failed to persist settings:', e));
}

/** Queue settings persistence for high-frequency controls like sliders. */
export function queueSettingsPersist(delayMs = 160): void {
  if (!_lastSettings) return;
  if (_queuedPersistTimer !== null) {
    globalThis.clearTimeout(_queuedPersistTimer);
  }
  _queuedPersistTimer = globalThis.setTimeout(() => {
    _queuedPersistTimer = null;
    persistCurrentSettings();
  }, delayMs);
}

/** Flush a queued settings write immediately, if one is pending. */
export function flushQueuedSettingsPersist(): void {
  if (_queuedPersistTimer === null) return;
  globalThis.clearTimeout(_queuedPersistTimer);
  _queuedPersistTimer = null;
  persistCurrentSettings();
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
