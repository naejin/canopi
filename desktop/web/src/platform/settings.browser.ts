import type { SettingsPlatformAdapter } from '../app/settings/platform-adapter'
import {
  DEFAULT_SETTINGS,
  SETTINGS_BASEMAP_STYLES,
  SETTINGS_LOCALES,
  SETTINGS_THEMES,
} from '../generated/settings'
import type { Settings } from '../types/settings'
import {
  browserAppDataStore,
  type BrowserAppDataStore,
} from '../web/browser-app-data'

type BrowserSettingsStore = Pick<BrowserAppDataStore, 'loadSettings' | 'saveSettings'>

const MAX_U32 = 4_294_967_295

export function createBrowserSettingsPlatformAdapter(
  store: BrowserSettingsStore = browserAppDataStore,
): SettingsPlatformAdapter {
  return {
    load: () => readBrowserSettings(store.loadSettings()),
    save: async (settings) => {
      const result = store.saveSettings({ ...settings })
      if (!result.ok) throw result.error
    },
  }
}

export const browserSettingsPlatformAdapter = createBrowserSettingsPlatformAdapter()

function readBrowserSettings(stored: Record<string, unknown> | null): Settings {
  const value = stored ?? {}
  return {
    locale: readEnum(value.locale, SETTINGS_LOCALES, DEFAULT_SETTINGS.locale),
    theme: readEnum(value.theme, SETTINGS_THEMES, DEFAULT_SETTINGS.theme),
    snap_to_grid: readBoolean(value.snap_to_grid, DEFAULT_SETTINGS.snap_to_grid),
    snap_to_guides: readBoolean(value.snap_to_guides, DEFAULT_SETTINGS.snap_to_guides),
    auto_save_interval_s: readU32(
      value.auto_save_interval_s,
      DEFAULT_SETTINGS.auto_save_interval_s,
    ),
    side_panel_width: readNullableU32(value.side_panel_width, DEFAULT_SETTINGS.side_panel_width),
    saved_stamps_frame_height: readNullableU32(
      value.saved_stamps_frame_height,
      DEFAULT_SETTINGS.saved_stamps_frame_height,
    ),
    bottom_panel_open: readBoolean(value.bottom_panel_open, DEFAULT_SETTINGS.bottom_panel_open),
    bottom_panel_timeline_height: readNullableU32(
      value.bottom_panel_timeline_height,
      DEFAULT_SETTINGS.bottom_panel_timeline_height,
    ),
    bottom_panel_budget_height: readNullableU32(
      value.bottom_panel_budget_height,
      DEFAULT_SETTINGS.bottom_panel_budget_height,
    ),
    bottom_panel_consortium_height: readNullableU32(
      value.bottom_panel_consortium_height,
      DEFAULT_SETTINGS.bottom_panel_consortium_height,
    ),
    bottom_panel_tab: readString(value.bottom_panel_tab, DEFAULT_SETTINGS.bottom_panel_tab),
    map_layer_visible: readBoolean(value.map_layer_visible, DEFAULT_SETTINGS.map_layer_visible),
    map_style: readEnum(
      value.map_style,
      SETTINGS_BASEMAP_STYLES,
      DEFAULT_SETTINGS.map_style,
    ),
    map_opacity: readFiniteNumber(value.map_opacity, DEFAULT_SETTINGS.map_opacity),
    contour_visible: readBoolean(value.contour_visible, DEFAULT_SETTINGS.contour_visible),
    contour_opacity: readFiniteNumber(value.contour_opacity, DEFAULT_SETTINGS.contour_opacity),
    contour_interval: readU32(value.contour_interval, DEFAULT_SETTINGS.contour_interval),
    hillshade_visible: readBoolean(value.hillshade_visible, DEFAULT_SETTINGS.hillshade_visible),
    hillshade_opacity: readFiniteNumber(
      value.hillshade_opacity,
      DEFAULT_SETTINGS.hillshade_opacity,
    ),
    plant_spacing_interval_m: readFiniteNumber(
      value.plant_spacing_interval_m,
      DEFAULT_SETTINGS.plant_spacing_interval_m,
    ),
  }
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readU32(value: unknown, fallback: number): number {
  return isU32(value) ? value : fallback
}

function readNullableU32(value: unknown, fallback: number | null): number | null {
  return value === null || isU32(value) ? value : fallback
}

function isU32(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_U32
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
