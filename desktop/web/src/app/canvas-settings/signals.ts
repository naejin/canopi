import { signal } from '@preact/signals'

export function createDefaultLayerVisibility(): Record<string, boolean> {
  return {
    base: true,
    contours: false,
    climate: false,
    zones: true,
    water: false,
    plants: true,
    annotations: true,
  }
}

export const layerVisibility = signal<Record<string, boolean>>(createDefaultLayerVisibility())

export const layerPanelOpen = signal<boolean>(true)
export const activeLayerName = signal<string>('zones')
export const snapToGridEnabled = signal<boolean>(false)
export const gridVisible = signal<boolean>(true)
export const rulersVisible = signal<boolean>(true)
export const snapToGuidesEnabled = signal<boolean>(true)

export function createDefaultLayerLockState(): Record<string, boolean> {
  return {
    base: false,
    contours: false,
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
    base: 1,
    contours: 1,
    climate: 1,
    zones: 1,
    water: 1,
    plants: 1,
    annotations: 1,
  }
}

export const layerOpacity = signal<Record<string, number>>(createDefaultLayerOpacity())

export const DEFAULT_CONTOUR_INTERVAL_METERS = 0
export const DEFAULT_HILLSHADE_VISIBLE = false
export const DEFAULT_HILLSHADE_OPACITY = 0.55
export const contourIntervalMeters = signal<number>(DEFAULT_CONTOUR_INTERVAL_METERS)
export const hillshadeVisible = signal<boolean>(DEFAULT_HILLSHADE_VISIBLE)
export const hillshadeOpacity = signal<number>(DEFAULT_HILLSHADE_OPACITY)

export function hasVisibleMapLayer(
  visibility: Record<string, boolean>,
  hillshadeOn: boolean,
): boolean {
  return (visibility.base ?? true)
    || (visibility.contours ?? false)
    || hillshadeOn
}
