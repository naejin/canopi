import type { MapFrame } from '../canvas/maplibre-camera'
import type { ScenePersistedState } from '../canvas/runtime/scene'
import {
  createProjectionPrecisionSnapshot,
  getActiveProjectionBackend,
} from '../canvas/projection'

export {
  LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
  computeSceneExtentMeters,
} from '../canvas/projection'

export type MapLibreCanvasSurfaceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MapLibreCanvasSurfaceState {
  readonly status: MapLibreCanvasSurfaceStatus
  readonly errorMessage: string | null
  readonly terrainStatus: MapLibreCanvasSurfaceStatus
  readonly terrainErrorMessage: string | null
  readonly precisionWarning: boolean
  readonly designExtentMeters: number | null
}

export type MapLibreCanvasSurfaceStateInput = Omit<
  MapLibreCanvasSurfaceState,
  'precisionWarning' | 'designExtentMeters'
>

export const IDLE_MAPLIBRE_CANVAS_SURFACE_STATE: MapLibreCanvasSurfaceState = {
  status: 'idle',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
  precisionWarning: false,
  designExtentMeters: null,
}

export function precisionSnapshot(scene: ScenePersistedState | null): Pick<
  MapLibreCanvasSurfaceState,
  'precisionWarning' | 'designExtentMeters'
> {
  const precision = createProjectionPrecisionSnapshot(scene)
  return {
    precisionWarning: precision.precisionWarning,
    designExtentMeters: precision.designExtentMeters,
  }
}

export function mergeMapLibreCanvasSurfaceState(
  next: MapLibreCanvasSurfaceStateInput,
  scene: ScenePersistedState | null,
): MapLibreCanvasSurfaceState {
  return {
    ...next,
    ...precisionSnapshot(scene),
  }
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
    && left.precisionWarning === right.precisionWarning
    && left.designExtentMeters === right.designExtentMeters
  )
}

export function publishMapDiagnostics(
  frame: MapFrame | null,
  designExtentMeters: number | null,
): void {
  if (!import.meta.env.DEV) return
  const warningThresholdMeters = frame?.diagnostics.warningThresholdMeters
    ?? getActiveProjectionBackend().warningThresholdMeters
  const backendId = frame?.diagnostics.backendId ?? getActiveProjectionBackend().id
  const precisionWarning = designExtentMeters != null && designExtentMeters > warningThresholdMeters
  ;(globalThis as { __CANOPI_MAP_DEBUG__?: unknown }).__CANOPI_MAP_DEBUG__ = frame
    ? {
      projectionBackendId: backendId,
      precisionWarningThresholdMeters: warningThresholdMeters,
      center: frame.center,
      zoom: frame.zoom,
      bearing: frame.bearing,
      viewportCenterWorld: frame.diagnostics.viewportCenterWorld,
      viewportCornerGeo: frame.diagnostics.viewportCornerGeo,
      designExtentMeters,
      precisionWarning,
    }
    : null
}
