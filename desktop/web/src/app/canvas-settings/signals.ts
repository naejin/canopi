import { signal } from '@preact/signals'
import { NEW_DESIGN_LAYER_DEFAULTS } from '../../generated/new-design-defaults'
import { DEFAULT_SETTINGS } from '../../generated/settings'

/** One value per New Design layer, from the generated defaults (common-types/canopi-new-design-defaults.json). */
function perNewDesignLayer<T>(read: (layer: (typeof NEW_DESIGN_LAYER_DEFAULTS)[number]) => T): Record<string, T> {
  return Object.fromEntries(NEW_DESIGN_LAYER_DEFAULTS.map((layer) => [layer.name, read(layer)]))
}

export function createDefaultLayerVisibility(): Record<string, boolean> {
  return perNewDesignLayer((layer) => layer.visible)
}

export const layerVisibility = signal<Record<string, boolean>>(createDefaultLayerVisibility())

export const activeLayerName = signal<string>('zones')
export const snapToGridEnabled = signal<boolean>(DEFAULT_SETTINGS.snap_to_grid)
export const gridVisible = signal<boolean>(true)
export const rulersVisible = signal<boolean>(true)
export const snapToGuidesEnabled = signal<boolean>(DEFAULT_SETTINGS.snap_to_guides)

export function createDefaultLayerLockState(): Record<string, boolean> {
  return perNewDesignLayer((layer) => layer.locked)
}

export const layerLockState = signal<Record<string, boolean>>(createDefaultLayerLockState())

export function createDefaultLayerOpacity(): Record<string, number> {
  return perNewDesignLayer((layer) => layer.opacity)
}

export const layerOpacity = signal<Record<string, number>>(createDefaultLayerOpacity())
