import { signal } from '@preact/signals'
import { NEW_DESIGN_LAYER_DEFAULTS } from '../../generated/new-design-defaults'
import { DEFAULT_SETTINGS } from '../../generated/settings'

/** One value per New Design layer, from the generated defaults (common-types/canopi-new-design-defaults.json). */
function perNewDesignLayer<T>(read: (layer: (typeof NEW_DESIGN_LAYER_DEFAULTS)[number]) => T): Record<string, T> {
  return Object.fromEntries(NEW_DESIGN_LAYER_DEFAULTS.map((layer) => [layer.name, read(layer)]))
}

export const layerVisibility = signal<Record<string, boolean>>(perNewDesignLayer((layer) => layer.visible))

export const activeLayerName = signal<string>('zones')
export const snapToGridEnabled = signal<boolean>(DEFAULT_SETTINGS.snap_to_grid)
export const gridVisible = signal<boolean>(true)

export const layerLockState = signal<Record<string, boolean>>(perNewDesignLayer((layer) => layer.locked))

export const layerOpacity = signal<Record<string, number>>(perNewDesignLayer((layer) => layer.opacity))
