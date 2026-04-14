import { batch, signal } from '@preact/signals'
import type { Settings } from '../../types/settings'
import { setSettings } from '../../ipc/settings'
import {
  contourIntervalMeters,
  snapToGridEnabled,
  snapToGuidesEnabled,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
} from '../canvas-settings/signals'
import {
  VISIBLE_BOTTOM_PANEL_TABS,
  bottomPanelHeight,
  bottomPanelOpen,
  bottomPanelTab,
} from '../canvas-settings/bottom-panel-state'
import {
  autoSaveIntervalMs,
  basemapStyle,
  checkUpdatesEnabled,
  locale,
  theme,
  updateChannel,
} from './state'
import { normalizeBasemapStyle } from '../../maplibre/config'

let lastSettings: Settings | null = null
let queuedPersistTimer: ReturnType<typeof globalThis.setTimeout> | null = null
export const settingsHydrated = signal(false)

function clampUnitInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function normalizeContourInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value))
}

export function setBootstrappedSettings(settings: Settings): void {
  batch(() => {
    locale.value = settings.locale
    theme.value = settings.theme === 'dark' ? 'dark' : 'light'
    basemapStyle.value = normalizeBasemapStyle(settings.map_style)
    checkUpdatesEnabled.value = settings.check_updates
    updateChannel.value = settings.update_channel ?? 'stable'
    snapToGridEnabled.value = settings.snap_to_grid
    snapToGuidesEnabled.value = settings.snap_to_guides
    autoSaveIntervalMs.value = settings.auto_save_interval_s * 1000
    bottomPanelOpen.value = settings.bottom_panel_open
    bottomPanelHeight.value = settings.bottom_panel_height
    if (VISIBLE_BOTTOM_PANEL_TABS.includes(settings.bottom_panel_tab as typeof bottomPanelTab.value)) {
      bottomPanelTab.value = settings.bottom_panel_tab as typeof bottomPanelTab.value
    }
    layerVisibility.value = {
      ...layerVisibility.value,
      base: settings.map_layer_visible,
      contours: settings.contour_visible,
    }
    layerOpacity.value = {
      ...layerOpacity.value,
      base: clampUnitInterval(settings.map_opacity, 1),
      contours: clampUnitInterval(settings.contour_opacity, 1),
    }
    contourIntervalMeters.value = normalizeContourInterval(settings.contour_interval, 0)
    hillshadeVisible.value = settings.hillshade_visible
    hillshadeOpacity.value = clampUnitInterval(settings.hillshade_opacity, 0.55)
  })
  lastSettings = settings
  settingsHydrated.value = true
}

export function persistCurrentSettings(): void {
  if (!lastSettings) return
  if (queuedPersistTimer !== null) {
    globalThis.clearTimeout(queuedPersistTimer)
    queuedPersistTimer = null
  }
  const updated: Settings = {
    ...lastSettings,
    locale: locale.value,
    theme: theme.value,
    check_updates: checkUpdatesEnabled.value,
    update_channel: updateChannel.value,
    snap_to_grid: snapToGridEnabled.value,
    snap_to_guides: snapToGuidesEnabled.value,
    auto_save_interval_s: Math.round(autoSaveIntervalMs.value / 1000),
    bottom_panel_open: bottomPanelOpen.value,
    bottom_panel_height: bottomPanelHeight.value,
    bottom_panel_tab: bottomPanelTab.value,
    map_layer_visible: layerVisibility.value.base ?? true,
    map_style: basemapStyle.value,
    map_opacity: clampUnitInterval(layerOpacity.value.base ?? 1, 1),
    contour_visible: layerVisibility.value.contours ?? false,
    contour_opacity: clampUnitInterval(layerOpacity.value.contours ?? 1, 1),
    contour_interval: normalizeContourInterval(contourIntervalMeters.value, 0),
    hillshade_visible: hillshadeVisible.value,
    hillshade_opacity: clampUnitInterval(hillshadeOpacity.value, 0.55),
  }
  lastSettings = updated
  setSettings(updated).catch((error) => console.error('Failed to persist settings:', error))
}

export function queueSettingsPersist(delayMs = 160): void {
  if (!lastSettings) return
  if (queuedPersistTimer !== null) {
    globalThis.clearTimeout(queuedPersistTimer)
  }
  queuedPersistTimer = globalThis.setTimeout(() => {
    queuedPersistTimer = null
    persistCurrentSettings()
  }, delayMs)
}

export function flushQueuedSettingsPersist(): void {
  if (queuedPersistTimer === null) return
  globalThis.clearTimeout(queuedPersistTimer)
  queuedPersistTimer = null
  persistCurrentSettings()
}
