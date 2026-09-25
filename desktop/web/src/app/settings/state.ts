import { signal } from '@preact/signals'
import type { LastView, Locale, Theme } from '../../generated/contracts'
import { DEFAULT_SETTINGS } from '../../generated/settings'

export const locale = signal<Locale>(DEFAULT_SETTINGS.locale)
export const theme = signal<Theme>(DEFAULT_SETTINGS.theme)

/**
 * Device-local Google Maps API key, or null for the keyless tile path.
 *
 * This is a browser credential: it lives in device settings only and must
 * never reach a Design, export, diagnostic bundle, log or error text.
 */
export const googleMapsApiKey = signal<string | null>(
  DEFAULT_SETTINGS.google_maps_api_key ?? null,
)

/** Autosave interval in milliseconds — hydrated from platform settings on startup. */
export const autoSaveIntervalMs = signal<number>(DEFAULT_SETTINGS.auto_save_interval_s * 1000)

/** The camera view last shown on a Design; a new Design opens here. */
export const lastView = signal<LastView | null>(DEFAULT_SETTINGS.last_view ?? null)

/** Plant Spacing Interval in meters — app tool preference, not design data. */
export const plantSpacingIntervalM = signal<number>(DEFAULT_SETTINGS.plant_spacing_interval_m)

export const DEFAULT_SAVED_STAMPS_FRAME_HEIGHT = 220
export const MIN_FAVORITES_FRAME_HEIGHT = 120

/** Saved Stamps frame height in pixels — app preference, not design data. */
export const savedStampsFrameHeight = signal<number>(
  DEFAULT_SETTINGS.saved_stamps_frame_height ?? DEFAULT_SAVED_STAMPS_FRAME_HEIGHT,
)
