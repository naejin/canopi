import type { ViewDiagnostics } from '../canvas/runtime/view/types'

type MapLibreCanvasSurfaceStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The OpenFreeMap Basemap: `failed` from a failed style download until it loads, is hidden or Satellite is chosen. */
export type MapLibreBasemapStatus = 'idle' | 'ok' | 'failed'

export interface MapLibreCanvasSurfaceState {
  readonly status: MapLibreCanvasSurfaceStatus
  readonly errorMessage: string | null
  readonly terrainStatus: MapLibreCanvasSurfaceStatus
  readonly terrainErrorMessage: string | null
  /** An optional map contribution (overlay, raster band) was skipped; the map stays editable. */
  readonly layerSkipped: boolean
  readonly basemapStatus: MapLibreBasemapStatus
  /** With status `error`: a user Retry can rebuild the map (WebGL2 present, the runtime alive). */
  readonly retryable: boolean
}

export const IDLE_MAPLIBRE_CANVAS_SURFACE_STATE: MapLibreCanvasSurfaceState = {
  status: 'idle',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
  layerSkipped: false,
  basemapStatus: 'idle',
  retryable: false,
}

export function mapLibreCanvasSurfaceStateEquals(
  left: MapLibreCanvasSurfaceState,
  right: MapLibreCanvasSurfaceState,
): boolean {
  return (
    left.status === right.status
    && left.errorMessage === right.errorMessage
    && left.terrainStatus === right.terrainStatus
    && left.terrainErrorMessage === right.terrainErrorMessage
    && left.layerSkipped === right.layerSkipped
    && left.basemapStatus === right.basemapStatus
    && left.retryable === right.retryable
  )
}

/** Development builds: the settled camera, as the map shows it, for the console. */
export function publishMapDiagnostics(frame: ViewDiagnostics | null): void {
  if (!import.meta.env.DEV) return
  ;(globalThis as { __CANOPI_MAP_DEBUG__?: unknown }).__CANOPI_MAP_DEBUG__ = frame
    ? {
      center: [frame.camera.center.lon, frame.camera.center.lat],
      zoom: frame.camera.zoom,
      bearing: frame.camera.bearingDeg,
      pitch: frame.camera.pitchDeg,
      centreWorld: frame.centreWorld,
      groundQuadGeo: frame.groundQuadGeo,
    }
    : null
}
