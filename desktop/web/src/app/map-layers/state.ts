import { computed, signal } from '@preact/signals'
import type { BasemapStyle, SatelliteProvider } from '../../generated/contracts'
import {
  DEFAULT_SETTINGS,
  SETTINGS_BASEMAP_STYLES,
  SETTINGS_SATELLITE_PROVIDERS,
} from '../../generated/settings'

/**
 * The map layer store: the single authority for the map layers under the
 * design (Basemap, Satellite, Contours, Hillshade). LiDAR items stay with the
 * Design's LiDAR presentation. Settings persist this state; it is never undoable.
 */
export interface MapLayersState {
  readonly basemap: {
    readonly style: BasemapStyle
    readonly visible: boolean
    readonly opacity: number
  }
  readonly satellite: {
    readonly provider: SatelliteProvider
    readonly visible: boolean
    readonly opacity: number
  }
  readonly contours: {
    readonly visible: boolean
    readonly opacity: number
    readonly intervalMeters: number
  }
  readonly hillshade: {
    readonly visible: boolean
    readonly opacity: number
  }
}

export function createDefaultMapLayers(): MapLayersState {
  return normalizeMapLayers({
    basemap: {
      style: DEFAULT_SETTINGS.basemap_style,
      visible: DEFAULT_SETTINGS.basemap_visible,
      opacity: DEFAULT_SETTINGS.basemap_opacity,
    },
    satellite: {
      provider: DEFAULT_SETTINGS.satellite_provider,
      visible: DEFAULT_SETTINGS.satellite_visible,
      opacity: DEFAULT_SETTINGS.satellite_opacity,
    },
    contours: {
      visible: DEFAULT_SETTINGS.contour_visible,
      opacity: DEFAULT_SETTINGS.contour_opacity,
      intervalMeters: DEFAULT_SETTINGS.contour_interval,
    },
    hillshade: {
      visible: DEFAULT_SETTINGS.hillshade_visible,
      opacity: DEFAULT_SETTINGS.hillshade_opacity,
    },
  })
}

export const mapLayers = signal<MapLayersState>(createDefaultMapLayers())

/** Which layer paints the background band: Satellite hides the Basemap. */
export type MapBackground = 'satellite' | 'basemap' | 'none'

export function mapBackgroundOf(state: MapLayersState): MapBackground {
  if (state.satellite.visible) return 'satellite'
  return state.basemap.visible ? 'basemap' : 'none'
}

export const mapBackground = computed(() => mapBackgroundOf(mapLayers.value))

export function hasVisibleMapLayer(state: MapLayersState): boolean {
  return mapBackgroundOf(state) !== 'none' || state.contours.visible || state.hillshade.visible
}

export function normalizeMapLayers(state: MapLayersState): MapLayersState {
  return Object.freeze({
    basemap: Object.freeze({
      style: SETTINGS_BASEMAP_STYLES.includes(state.basemap.style)
        ? state.basemap.style
        : DEFAULT_SETTINGS.basemap_style,
      visible: state.basemap.visible === true,
      opacity: unitInterval(state.basemap.opacity, 1),
    }),
    satellite: Object.freeze({
      provider: SETTINGS_SATELLITE_PROVIDERS.includes(state.satellite.provider)
        ? state.satellite.provider
        : DEFAULT_SETTINGS.satellite_provider,
      visible: state.satellite.visible === true,
      opacity: unitInterval(state.satellite.opacity, 1),
    }),
    contours: Object.freeze({
      visible: state.contours.visible === true,
      opacity: unitInterval(state.contours.opacity, 1),
      // Persisted as whole metres (u32 in the settings contract).
      intervalMeters: Number.isFinite(state.contours.intervalMeters) && state.contours.intervalMeters >= 0
        ? Math.round(state.contours.intervalMeters)
        : 0,
    }),
    hillshade: Object.freeze({
      visible: state.hillshade.visible === true,
      opacity: unitInterval(state.hillshade.opacity, DEFAULT_SETTINGS.hillshade_opacity),
    }),
  })
}

export function mapLayersEqual(left: MapLayersState, right: MapLayersState): boolean {
  return left.basemap.style === right.basemap.style
    && left.basemap.visible === right.basemap.visible
    && left.basemap.opacity === right.basemap.opacity
    && left.satellite.provider === right.satellite.provider
    && left.satellite.visible === right.satellite.visible
    && left.satellite.opacity === right.satellite.opacity
    && left.contours.visible === right.contours.visible
    && left.contours.opacity === right.contours.opacity
    && left.contours.intervalMeters === right.contours.intervalMeters
    && left.hillshade.visible === right.hillshade.visible
    && left.hillshade.opacity === right.hillshade.opacity
}

function unitInterval(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
}

/** Contours and Hillshade in the shape the terrain contribution consumes. */
export function mapTerrainStateOf(state: MapLayersState) {
  return {
    contoursVisible: state.contours.visible,
    contoursOpacity: state.contours.opacity,
    contourIntervalMeters: state.contours.intervalMeters,
    hillshadeVisible: state.hillshade.visible,
    hillshadeOpacity: state.hillshade.opacity,
  }
}
