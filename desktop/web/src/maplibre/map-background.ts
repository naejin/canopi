import type { BasemapStyle } from '../generated/contracts'
import {
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_SATELLITE_LAYER_ID,
} from './config'
import type { BasemapTileAuth } from './basemap-tile-auth'
import type { MapLibreBasemapStatus } from './canvas-surface-state'
import {
  OPENFREEMAP_LAYER_PREFIX,
  VectorBasemap,
  type VectorBasemapMap,
  type VectorStyleDocument,
} from './openfreemap-basemap'
import {
  createSatelliteImagery,
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
function isMapBackgroundLayer(id: string): boolean {
  return id === MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID
    || id === MAPLIBRE_SATELLITE_LAYER_ID
    || id.startsWith(OPENFREEMAP_LAYER_PREFIX)
}

export type MapBackgroundMap = VectorBasemapMap & SatelliteMountOptions['map'] & {
  getLayersOrder(): string[]
  setPaintProperty(id: string, name: string, value: unknown): void
  isStyleLoaded?(): boolean
  loaded?(): boolean
  getBounds?(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }
  getZoom?(): number
  addControl?(control: unknown, position?: string): unknown
  removeControl?(control: unknown): unknown
  getContainer?(): HTMLElement
}

export interface MapBackgroundOptions {
  readonly map: MapBackgroundMap
  readonly maplibre: unknown
  /** The map's credential owner, created with its request transform. */
  readonly tileAuth: BasemapTileAuth
  readonly lifetime: {
    on(type: string, listener: (event?: unknown) => void): void
    off(type: string, listener: (event?: unknown) => void): void
  }
  readonly loadStyle?: (url: string) => Promise<VectorStyleDocument>
  readonly onError?: (error: unknown) => void
  /** The Basemap's download status; hidden, also under Satellite, is `idle`. */
  readonly onBasemapStatus?: (status: MapLibreBasemapStatus) => void
}

export interface MapBackgroundHandle {
  /** Applies the presentation when it differs from the last one; the same one again does nothing (no download). */
  update(presentation: MapBackgroundPresentation): void
  /** Retry: applies the presentation, downloading a Basemap that couldn't load (its style or its resources) again. */
  retry(presentation: MapBackgroundPresentation): void
  /**
   * Claims a map error about the Basemap's sprite or TileJSON (VectorBasemap.claimResourceError), which
   * names no layer: the Basemap shows it couldn't load, and the map is not failed.
   */
  claimMapError(event: unknown): boolean
  /**
   * Whether the latest presentation is on the map: the requested Basemap style
   * installed, or the Satellite layer added. Tile loading is not part of it.
   */
  isApplied(): boolean
  /**
   * Folds the credits into MapLibre's (i) button (true) or keeps them
   * expanded (false), for a surface that knows how much room they have.
   * Until it is called, MapLibre folds them only on a map 640 px or narrower.
   */
  setAttributionCompact(compact: boolean): void
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
    ...(options.onBasemapStatus ? { onStatus: options.onBasemapStatus } : {}),
  })
  // MapLibre is idle only once the Basemap's sprite request has settled (VectorBasemap.claimResourceError).
  const onIdle = () => vector.noteMapIdle()
  options.lifetime.on('idle', onIdle)
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
        provider: createSatelliteImagery(options.tileAuth),
        map,
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

  // At most one pending style-ready wait: it applies whatever presentation is
  // latest when it fires, so later updates need no wait of their own.
  let cancelReadyWait: (() => void) | null = null
  const schedule = () => {
    if (readiness.isReady()) {
      cancelReadyWait?.()
      cancelReadyWait = null
      apply()
      return
    }
    if (cancelReadyWait) return
    cancelReadyWait = readiness.whenReady(() => {
      cancelReadyWait = null
      apply()
    })
  }

  const show = (next: MapBackgroundPresentation) => {
    presentation = captureMapBackgroundPresentation(next)
    schedule()
  }

  return {
    // A surface may send the same presentation again whenever anything else it reads changes (the view, the visible map
    // area); only a change reaches the band, so a Basemap that failed to download stays failed until Retry (ADR 0004).
    update(next) {
      if (disposed || (presentation && mapBackgroundPresentationsEqual(presentation, next))) return
      show(next)
    },
    retry(next) {
      if (disposed) return
      vector.discardFailedResources()
      show(next)
    },
    claimMapError(event) {
      return !disposed && vector.claimResourceError(event)
    },
    isApplied() {
      if (disposed || !presentation || !readiness.isReady()) return false
      if (presentation.satellite.visible) return map.getLayer(MAPLIBRE_SATELLITE_LAYER_ID) != null
      if (presentation.basemap.visible) return vector.installedStyle === presentation.basemap.style
      return true
    },
    setAttributionCompact(compact) {
      if (disposed) return
      attribution.setCompact(compact)
    },
    dispose() {
      if (disposed) return
      disposed = true
      options.lifetime.off('idle', onIdle)
      cancelReadyWait?.()
      cancelReadyWait = null
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
 * One attribution control per map. It lists every visible source's
 * attribution (the OpenFreeMap TileJSON credit) and the Google satellite
 * copyright as custom attribution. Options are fixed when MapLibre adds a
 * control, so a new credit or fold remounts it.
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
  // Unset: MapLibre folds the credits into an (i) button only on a map 640 px
  // wide or narrower, so imagery terms stay readable elsewhere.
  let compact: boolean | undefined
  let foldWatch: MutationObserver | null = null
  // A compact control opens showing its credits and folds on the first map
  // drag, which the workspace map never has: fold it as soon as MapLibre makes
  // it compact (at once, or when the first source credits arrive).
  const foldWhenCompact = () => {
    const credits = map.getContainer?.().querySelector('.maplibregl-ctrl-attrib')
    if (!credits) return
    const fold = () => {
      if (!credits.classList.contains('maplibregl-compact')) return false
      credits.classList.remove('maplibregl-compact-show')
      return true
    }
    if (fold() || typeof MutationObserver === 'undefined') return
    foldWatch = new MutationObserver(() => {
      if (!fold()) return
      foldWatch?.disconnect()
      foldWatch = null
    })
    foldWatch.observe(credits, { attributes: true, attributeFilter: ['class'] })
  }
  const mount = () => {
    if (!Control || !map.addControl) return
    control = new Control({
      ...(compact === undefined ? {} : { compact }),
      ...(credit ? { customAttribution: credit } : {}),
    })
    map.addControl(control, 'bottom-right')
    if (compact) foldWhenCompact()
  }
  const unmount = () => {
    foldWatch?.disconnect()
    foldWatch = null
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
    setCompact(next: boolean) {
      if (next === compact) return
      compact = next
      unmount()
      mount()
    },
    dispose: unmount,
  }
}

function unitInterval(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}
