import { signal } from '@preact/signals'
import { DEFAULT_SETTINGS } from '../../generated/settings'

export function createDefaultLayerVisibility(): Record<string, boolean> {
  return {
    climate: false,
    zones: true,
    water: false,
    plants: true,
    annotations: true,
  }
}

export const layerVisibility = signal<Record<string, boolean>>(createDefaultLayerVisibility())

export const activeLayerName = signal<string>('zones')
export const snapToGridEnabled = signal<boolean>(DEFAULT_SETTINGS.snap_to_grid)
export const gridVisible = signal<boolean>(true)
export const rulersVisible = signal<boolean>(true)
export const snapToGuidesEnabled = signal<boolean>(DEFAULT_SETTINGS.snap_to_guides)

export function createDefaultLayerLockState(): Record<string, boolean> {
  return {
    climate: false,
    zones: false,
    water: false,
    plants: false,
    annotations: false,
  }
}

export const layerLockState = signal<Record<string, boolean>>(createDefaultLayerLockState())

export function createDefaultLayerOpacity(): Record<string, number> {
  return {
    climate: 1,
    zones: 1,
    water: 1,
    plants: 1,
    annotations: 1,
  }
}

export const layerOpacity = signal<Record<string, number>>(createDefaultLayerOpacity())
