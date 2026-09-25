import type { MapFrame } from '../canvas/maplibre-camera'

export type MapLibreCanvasSurfaceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MapLibreCanvasSurfaceState {
  readonly status: MapLibreCanvasSurfaceStatus
  readonly errorMessage: string | null
  readonly terrainStatus: MapLibreCanvasSurfaceStatus
  readonly terrainErrorMessage: string | null
}

export const IDLE_MAPLIBRE_CANVAS_SURFACE_STATE: MapLibreCanvasSurfaceState = {
  status: 'idle',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
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
  )
}

export function publishMapDiagnostics(frame: MapFrame | null): void {
  if (!import.meta.env.DEV) return
  ;(globalThis as { __CANOPI_MAP_DEBUG__?: unknown }).__CANOPI_MAP_DEBUG__ = frame
    ? {
      projectionId: frame.diagnostics.projectionId,
      center: frame.center,
      zoom: frame.zoom,
      bearing: frame.bearing,
      viewportCenterWorld: frame.diagnostics.viewportCenterWorld,
      viewportCornerGeo: frame.diagnostics.viewportCornerGeo,
    }
    : null
}
