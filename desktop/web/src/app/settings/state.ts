import { signal } from '@preact/signals'
import type { BasemapStyle } from '../../generated/contracts'
import { FALLBACK_PLANT_SPACING_INTERVAL_M } from '../../canvas/plant-spacing-interval'

export const locale = signal<"en" | "fr" | "es" | "pt" | "it" | "zh" | "de" | "ja" | "ko" | "nl" | "ru">('en')
export const theme = signal<'light' | 'dark'>('light')
export const basemapStyle = signal<BasemapStyle>('street')

/** Autosave interval in milliseconds — hydrated from Rust settings on startup. */
export const autoSaveIntervalMs = signal<number>(60_000)

/** Plant Spacing Interval in meters — app tool preference, not design data. */
export const plantSpacingIntervalM = signal<number>(FALLBACK_PLANT_SPACING_INTERVAL_M)
