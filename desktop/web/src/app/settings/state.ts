import { signal } from '@preact/signals'
import type { BasemapStyle, Locale, Theme } from '../../generated/contracts'
import { DEFAULT_SETTINGS } from '../../generated/settings'

export const locale = signal<Locale>(DEFAULT_SETTINGS.locale)
export const theme = signal<Theme>(DEFAULT_SETTINGS.theme)
export const basemapStyle = signal<BasemapStyle>(DEFAULT_SETTINGS.map_style)

/** Autosave interval in milliseconds — hydrated from platform settings on startup. */
export const autoSaveIntervalMs = signal<number>(DEFAULT_SETTINGS.auto_save_interval_s * 1000)

/** Plant Spacing Interval in meters — app tool preference, not design data. */
export const plantSpacingIntervalM = signal<number>(DEFAULT_SETTINGS.plant_spacing_interval_m)

export const DEFAULT_SAVED_STAMPS_FRAME_HEIGHT = 220
export const MIN_FAVORITES_FRAME_HEIGHT = 120

/** Saved Stamps frame height in pixels — app preference, not design data. */
export const savedStampsFrameHeight = signal<number>(
  DEFAULT_SETTINGS.saved_stamps_frame_height ?? DEFAULT_SAVED_STAMPS_FRAME_HEIGHT,
)
