import { signal } from '@preact/signals'
import type { BasemapStyle, UpdateChannel } from '../../generated/contracts'

export const locale = signal<"en" | "fr" | "es" | "pt" | "it" | "zh" | "de" | "ja" | "ko" | "nl" | "ru">('en')
export const theme = signal<'light' | 'dark'>('light')
export const basemapStyle = signal<BasemapStyle>('street')
export const checkUpdatesEnabled = signal<boolean>(true)
export const updateChannel = signal<UpdateChannel>('stable')

/** Autosave interval in milliseconds — hydrated from Rust settings on startup. */
export const autoSaveIntervalMs = signal<number>(60_000)
