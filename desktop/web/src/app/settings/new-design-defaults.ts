import type { CanopiFile } from '../../types/design'
import { withPlantDisplayOptions } from '../design-edit/plant-display'
import { setMapBackground } from '../map-layers/actions'
import { newDesignDefaults, type NewDesignDefaults } from './state'

/**
 * Settings › New Designs, applied once, to a Design being created: its symbol
 * size and labels. An existing Design keeps its own display options.
 */
export function withNewDesignDisplay(
  file: CanopiFile,
  defaults: NewDesignDefaults = newDesignDefaults.peek(),
): CanopiFile {
  return withPlantDisplayOptions(file, {
    symbolScale: defaults.symbolScale,
    labels: defaults.labels,
  })
}

/**
 * Settings › New Designs › Open on satellite, applied when a Design is
 * created. Off keeps the background last used; the background is a device
 * setting, so an opened Design never changes it.
 */
export function applyNewDesignBackground(defaults: NewDesignDefaults = newDesignDefaults.peek()): void {
  if (defaults.satellite) setMapBackground('satellite')
}
