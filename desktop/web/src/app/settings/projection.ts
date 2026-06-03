import { batch } from '@preact/signals'
import type { BasemapStyle } from '../../generated/contracts'
import type { Locale, Settings, Theme } from '../../types/settings'
import { setSettings } from '../../ipc/settings'
import { FALLBACK_PLANT_SPACING_INTERVAL_M } from '../../canvas/plant-spacing-interval'
import { normalizeBasemapStyle } from '../../maplibre/config'
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
  type BottomPanelTab,
  bottomPanelHeight,
  bottomPanelOpen,
  bottomPanelTab,
} from '../canvas-settings/bottom-panel-state'
import { sidePanelWidth } from '../shell/state'
import {
  autoSaveIntervalMs,
  basemapStyle,
  locale,
  plantSpacingIntervalM,
  theme,
} from './state'

export type SettingsPersistMode = 'immediate' | 'queued' | 'none'

export interface SettingsProjectionDraft {
  locale: Locale
  theme: Theme
  basemapStyle: BasemapStyle
  snapToGrid: boolean
  snapToGuides: boolean
  autoSaveIntervalMs: number
  plantSpacingIntervalM: number
  sidePanel: {
    width: number | null
  }
  bottomPanel: {
    open: boolean
    height: number
    tab: BottomPanelTab
  }
  mapLayers: {
    baseVisible: boolean
    baseOpacity: number
    contoursVisible: boolean
    contoursOpacity: number
    contourIntervalMeters: number
    hillshadeVisible: boolean
    hillshadeOpacity: number
  }
}

interface MutateSettingsProjectionOptions {
  persist?: SettingsPersistMode
  delayMs?: number
}

type PersistSettings = (settings: Settings) => Promise<void>

const DEFAULT_QUEUED_PERSIST_DELAY_MS = 160
const DEFAULT_BOTTOM_PANEL_TAB: BottomPanelTab = 'budget'
const MIN_SIDE_PANEL_WIDTH = 320

let sourceSettings: Settings | null = null
let queuedPersistTimer: ReturnType<typeof globalThis.setTimeout> | null = null
let persistSettings: PersistSettings = setSettings

function clampUnitInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function normalizeContourInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value))
}

function normalizePositiveMeters(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

function normalizeSidePanelWidth(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.max(MIN_SIDE_PANEL_WIDTH, Math.round(value))
}

function normalizeTheme(value: Theme): Theme {
  return value === 'dark' ? 'dark' : 'light'
}

function normalizeBottomPanelTab(value: BottomPanelTab): BottomPanelTab {
  return VISIBLE_BOTTOM_PANEL_TABS.includes(value) ? value : DEFAULT_BOTTOM_PANEL_TAB
}

function createDraftFromProjection(): SettingsProjectionDraft {
  return {
    locale: locale.value,
    theme: theme.value,
    basemapStyle: basemapStyle.value,
    snapToGrid: snapToGridEnabled.value,
    snapToGuides: snapToGuidesEnabled.value,
    autoSaveIntervalMs: autoSaveIntervalMs.value,
    plantSpacingIntervalM: plantSpacingIntervalM.value,
    sidePanel: {
      width: sidePanelWidth.value,
    },
    bottomPanel: {
      open: bottomPanelOpen.value,
      height: bottomPanelHeight.value,
      tab: bottomPanelTab.value,
    },
    mapLayers: {
      baseVisible: layerVisibility.value.base ?? true,
      baseOpacity: layerOpacity.value.base ?? 1,
      contoursVisible: layerVisibility.value.contours ?? false,
      contoursOpacity: layerOpacity.value.contours ?? 1,
      contourIntervalMeters: contourIntervalMeters.value,
      hillshadeVisible: hillshadeVisible.value,
      hillshadeOpacity: hillshadeOpacity.value,
    },
  }
}

function normalizeDraft(draft: SettingsProjectionDraft): SettingsProjectionDraft {
  return {
    locale: draft.locale,
    theme: normalizeTheme(draft.theme),
    basemapStyle: normalizeBasemapStyle(draft.basemapStyle),
    snapToGrid: draft.snapToGrid,
    snapToGuides: draft.snapToGuides,
    autoSaveIntervalMs: Math.max(0, Math.round(draft.autoSaveIntervalMs)),
    plantSpacingIntervalM: normalizePositiveMeters(
      draft.plantSpacingIntervalM,
      FALLBACK_PLANT_SPACING_INTERVAL_M,
    ),
    sidePanel: {
      width: normalizeSidePanelWidth(draft.sidePanel.width),
    },
    bottomPanel: {
      open: draft.bottomPanel.open,
      height: draft.bottomPanel.height,
      tab: normalizeBottomPanelTab(draft.bottomPanel.tab),
    },
    mapLayers: {
      baseVisible: draft.mapLayers.baseVisible,
      baseOpacity: clampUnitInterval(draft.mapLayers.baseOpacity, 1),
      contoursVisible: draft.mapLayers.contoursVisible,
      contoursOpacity: clampUnitInterval(draft.mapLayers.contoursOpacity, 1),
      contourIntervalMeters: normalizeContourInterval(draft.mapLayers.contourIntervalMeters, 0),
      hillshadeVisible: draft.mapLayers.hillshadeVisible,
      hillshadeOpacity: clampUnitInterval(draft.mapLayers.hillshadeOpacity, 0.55),
    },
  }
}

function applyDraftToProjection(draft: SettingsProjectionDraft): void {
  batch(() => {
    locale.value = draft.locale
    theme.value = draft.theme
    basemapStyle.value = draft.basemapStyle
    snapToGridEnabled.value = draft.snapToGrid
    snapToGuidesEnabled.value = draft.snapToGuides
    autoSaveIntervalMs.value = draft.autoSaveIntervalMs
    plantSpacingIntervalM.value = draft.plantSpacingIntervalM
    sidePanelWidth.value = draft.sidePanel.width
    bottomPanelOpen.value = draft.bottomPanel.open
    bottomPanelHeight.value = draft.bottomPanel.height
    bottomPanelTab.value = draft.bottomPanel.tab
    layerVisibility.value = {
      ...layerVisibility.value,
      base: draft.mapLayers.baseVisible,
      contours: draft.mapLayers.contoursVisible,
    }
    layerOpacity.value = {
      ...layerOpacity.value,
      base: draft.mapLayers.baseOpacity,
      contours: draft.mapLayers.contoursOpacity,
    }
    contourIntervalMeters.value = draft.mapLayers.contourIntervalMeters
    hillshadeVisible.value = draft.mapLayers.hillshadeVisible
    hillshadeOpacity.value = draft.mapLayers.hillshadeOpacity
  })
}

function settingsFromDraft(base: Settings, draft: SettingsProjectionDraft): Settings {
  return {
    ...base,
    locale: draft.locale,
    theme: draft.theme,
    snap_to_grid: draft.snapToGrid,
    snap_to_guides: draft.snapToGuides,
    auto_save_interval_s: Math.round(draft.autoSaveIntervalMs / 1000),
    plant_spacing_interval_m: draft.plantSpacingIntervalM,
    side_panel_width: draft.sidePanel.width,
    bottom_panel_open: draft.bottomPanel.open,
    bottom_panel_height: draft.bottomPanel.height,
    bottom_panel_tab: draft.bottomPanel.tab,
    map_layer_visible: draft.mapLayers.baseVisible,
    map_style: draft.basemapStyle,
    map_opacity: draft.mapLayers.baseOpacity,
    contour_visible: draft.mapLayers.contoursVisible,
    contour_opacity: draft.mapLayers.contoursOpacity,
    contour_interval: draft.mapLayers.contourIntervalMeters,
    hillshade_visible: draft.mapLayers.hillshadeVisible,
    hillshade_opacity: draft.mapLayers.hillshadeOpacity,
  }
}

function settingsEqual(left: Settings, right: Settings): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function clearQueuedPersist(): void {
  if (queuedPersistTimer === null) return
  globalThis.clearTimeout(queuedPersistTimer)
  queuedPersistTimer = null
}

function persistSnapshot(settings: Settings): void {
  sourceSettings = settings
  persistSettings(settings).catch((error) => console.error('Failed to persist settings:', error))
}

function persistProjection(mode: SettingsPersistMode, delayMs = DEFAULT_QUEUED_PERSIST_DELAY_MS): void {
  if (mode === 'none') return
  if (!sourceSettings) return

  const updated = snapshotSettingsProjection()
  if (settingsEqual(updated, sourceSettings)) {
    clearQueuedPersist()
    return
  }

  if (mode === 'immediate') {
    clearQueuedPersist()
    persistSnapshot(updated)
    return
  }

  clearQueuedPersist()
  queuedPersistTimer = globalThis.setTimeout(() => {
    queuedPersistTimer = null
    if (!sourceSettings) return

    const queued = snapshotSettingsProjection()
    if (settingsEqual(queued, sourceSettings)) return
    persistSnapshot(queued)
  }, delayMs)
}

export function hydrateSettingsProjection(settings: Settings): void {
  clearQueuedPersist()
  const draft = normalizeDraft({
    locale: settings.locale,
    theme: settings.theme,
    basemapStyle: normalizeBasemapStyle(settings.map_style),
    snapToGrid: settings.snap_to_grid,
    snapToGuides: settings.snap_to_guides,
    autoSaveIntervalMs: settings.auto_save_interval_s * 1000,
    plantSpacingIntervalM: settings.plant_spacing_interval_m,
    sidePanel: {
      width: settings.side_panel_width,
    },
    bottomPanel: {
      open: settings.bottom_panel_open,
      height: settings.bottom_panel_height,
      tab: normalizeBottomPanelTab(settings.bottom_panel_tab as BottomPanelTab),
    },
    mapLayers: {
      baseVisible: settings.map_layer_visible,
      baseOpacity: settings.map_opacity,
      contoursVisible: settings.contour_visible,
      contoursOpacity: settings.contour_opacity,
      contourIntervalMeters: settings.contour_interval,
      hillshadeVisible: settings.hillshade_visible,
      hillshadeOpacity: settings.hillshade_opacity,
    },
  })
  applyDraftToProjection(draft)
  sourceSettings = settings
}

export function primeThemeProjectionFromFirstPaintCache(cachedTheme: Theme): void {
  theme.value = normalizeTheme(cachedTheme)
}

export function snapshotSettingsProjection(): Settings {
  if (!sourceSettings) {
    throw new Error('Cannot snapshot settings before Rust settings bootstrap')
  }
  return settingsFromDraft(sourceSettings, normalizeDraft(createDraftFromProjection()))
}

export function mutateSettingsProjection(
  mutate: (draft: SettingsProjectionDraft) => void,
  options: MutateSettingsProjectionOptions = {},
): void {
  const draft = createDraftFromProjection()
  mutate(draft)
  const normalized = normalizeDraft(draft)
  applyDraftToProjection(normalized)
  persistProjection(options.persist ?? 'immediate', options.delayMs)
}

export function flushSettingsProjection(): void {
  if (queuedPersistTimer === null) return
  clearQueuedPersist()
  persistProjection('immediate')
}

export function resetSettingsProjectionForTests(adapter: PersistSettings = setSettings): void {
  clearQueuedPersist()
  sourceSettings = null
  persistSettings = adapter
}
