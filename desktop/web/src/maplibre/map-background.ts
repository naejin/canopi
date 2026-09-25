import type { BasemapStyle } from '../generated/contracts'
import {
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_SATELLITE_LAYER_ID,
} from './config'
import type { BasemapTileAuth } from './basemap-tile-auth'
import {
  OPENFREEMAP_LAYER_PREFIX,
  VectorBasemap,
  type VectorBasemapMap,
  type VectorStyleDocument,
} from './openfreemap-basemap'
import {
  mapStyleReadiness,
  mountSatelliteLifecycle,
  type SatelliteMountHandle,
  type SatelliteMountOptions,
} from './satellite-bind'
import type { SatelliteViewport } from './satellite-provider-session'

/** The background band's inputs, read from the map layer store and settings. */
export interface MapBackgroundPresentation {
  readonly basemap: {
    readonly style: BasemapStyle
    readonly visible: boolean
    readonly opacity: number
  }
  readonly satellite: {
    readonly visible: boolean
    readonly opacity: number
  }
  readonly locale: string
}

export function captureMapBackgroundPresentation(
  presentation: MapBackgroundPresentation,
): MapBackgroundPresentation {
  return Object.freeze({
    basemap: Object.freeze({ ...presentation.basemap, opacity: unitInterval(presentation.basemap.opacity) }),
    satellite: Object.freeze({ ...presentation.satellite, opacity: unitInterval(presentation.satellite.opacity) }),
    locale: presentation.locale,
  })
}

export function mapBackgroundPresentationsEqual(
  left: MapBackgroundPresentation,
  right: MapBackgroundPresentation,
): boolean {
  return left.locale === right.locale
    && left.basemap.style === right.basemap.style
    && left.basemap.visible === right.basemap.visible
    && left.basemap.opacity === right.basemap.opacity
    && left.satellite.visible === right.satellite.visible
    && left.satellite.opacity === right.satellite.opacity
}

/** Every layer that belongs to the background band. */
export function isMapBackgroundLayer(id: string): boolean {
  return id === MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID
    || id === MAPLIBRE_SATELLITE_LAYER_ID
    || id.startsWith(OPENFREEMAP_LAYER_PREFIX)
}

export type MapBackgroundMap = VectorBasemapMap & SatelliteMountOptions['map'] & {
  getLayersOrder(): string[]
  isStyleLoaded?(): boolean
  loaded?(): boolean
  getBounds?(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }
  getZoom?(): number
  addControl?(control: unknown, position?: string): unknown
  removeControl?(control: unknown): unknown
}

export interface MapBackgroundOptions {
  readonly map: MapBackgroundMap
  readonly maplibre: unknown
  /** The map's credential owner, created with its request transform. */
  readonly tileAuth: BasemapTileAuth | null
  readonly lifetime: {
    on(type: string, listener: (event?: unknown) => void): void
    off?(type: string, listener: (event?: unknown) => void): void
  }
  readonly loadStyle?: (url: string) => Promise<VectorStyleDocument>
  readonly onError?: (error: unknown) => void
}

export interface MapBackgroundHandle {
  update(presentation: MapBackgroundPresentation): void
  /** Re-applies after a same-map style reload emptied the stack. */
  restore(): void
  dispose(): void
}

/**
 * The one owner of a map's background band: the OpenFreeMap Basemap or the
 * Satellite imagery (Satellite on hides the Basemap), plus their single
 * attribution control. Used by every map surface, so no surface binds a
 * basemap on its own. Nothing here calls `setStyle()`.
 */
export function mountMapBackground(options: MapBackgroundOptions): MapBackgroundHandle {
  const { map } = options
  const readiness = mapStyleReadiness(map, options.lifetime)
  const beforeLayerId = () => map.getLayersOrder().find((id) => !isMapBackgroundLayer(id)) ?? null
  const attribution = createAttributionOwner(options.maplibre, map)
  const vector = new VectorBasemap(map, {
    ...(options.loadStyle ? { loadStyle: options.loadStyle } : {}),
    beforeLayerId,
    ...(options.onError ? { onError: options.onError } : {}),
  })
  let presentation: MapBackgroundPresentation | null = null
  let satellite: SatelliteMountHandle | null = null
  let disposed = false

  const applySatelliteOpacity = () => {
    if (!presentation || !map.getLayer(MAPLIBRE_SATELLITE_LAYER_ID)) return
    map.setPaintProperty(MAPLIBRE_SATELLITE_LAYER_ID, 'raster-opacity', presentation.satellite.opacity)
  }

  const releaseSatellite = () => {
    satellite?.dispose()
    satellite = null
    attribution.setSatelliteCredit('')
  }

  const apply = () => {
    if (disposed || !presentation) return
    const current = presentation
    vector.update({
      style: current.basemap.style,
      visible: current.basemap.visible && !current.satellite.visible,
      opacity: current.basemap.opacity,
      locale: current.locale,
    })
    if (!current.satellite.visible) {
      releaseSatellite()
      return
    }
    if (!satellite) {
      satellite = mountSatelliteLifecycle({
        map,
        tileAuth: options.tileAuth,
        readViewport: () => readViewport(map),
        styleReady: readiness,
        beforeLayerId,
        afterApply: applySatelliteOpacity,
        replaceSatelliteAttribution: (credit) => attribution.setSatelliteCredit(credit),
        events: options.lifetime as SatelliteMountOptions['events'],
      })
      return
    }
    applySatelliteOpacity()
  }

  let waiting = false
  const schedule = () => {
    if (readiness.isReady()) {
      apply()
      return
    }
    if (waiting) return
    waiting = true
    readiness.whenReady(() => {
      waiting = false
      apply()
    })
  }

  return {
    update(next) {
      if (disposed) return
      presentation = captureMapBackgroundPresentation(next)
      schedule()
    },
    restore() {
      if (disposed) return
      vector.restore()
      if (satellite) satellite.update(readViewport(map))
    },
    dispose() {
      if (disposed) return
      disposed = true
      releaseSatellite()
      vector.dispose()
      attribution.dispose()
    },
  }
}

function readViewport(map: MapBackgroundMap): SatelliteViewport {
  const bounds = map.getBounds?.()
  const zoom = map.getZoom?.() ?? 0
  if (!bounds) return { west: -180, south: -85, east: 180, north: 85, zoom }
  return { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth(), zoom }
}

/**
 * One compact attribution control per map. It lists every visible source's
 * attribution (the OpenFreeMap TileJSON credit) and the Google satellite
 * copyright as custom attribution.
 */
function createAttributionOwner(maplibre: unknown, map: MapBackgroundMap) {
  type AttributionControlClass = new (options?: { compact?: boolean; customAttribution?: string | string[] }) => unknown
  let Control: AttributionControlClass | undefined
  try {
    Control = (maplibre as { AttributionControl?: AttributionControlClass } | null)?.AttributionControl
  } catch {
    Control = undefined
  }
  let control: unknown = null
  let credit = ''
  const mount = () => {
    if (!Control || !map.addControl) return
    control = new Control({ compact: true, ...(credit ? { customAttribution: credit } : {}) })
    map.addControl(control, 'bottom-right')
  }
  const unmount = () => {
    if (control && map.removeControl) map.removeControl(control)
    control = null
  }
  mount()
  return {
    setSatelliteCredit(next: string) {
      if (next === credit) return
      credit = next
      unmount()
      mount()
    },
    dispose: unmount,
  }
}

function unitInterval(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}
