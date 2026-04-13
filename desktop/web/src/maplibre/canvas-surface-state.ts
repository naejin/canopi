import type { MapFrame } from '../canvas/maplibre-camera'
import type { ScenePersistedState } from '../canvas/runtime/scene'

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

export const LOCAL_PROJECTION_WARNING_THRESHOLD_METERS = 10_000

export const IDLE_MAPLIBRE_CANVAS_SURFACE_STATE: MapLibreCanvasSurfaceState = {
  status: 'idle',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
  precisionWarning: false,
  designExtentMeters: null,
}

export function computeSceneExtentMeters(scene: ScenePersistedState): number | null {
  let maxDistanceMeters = 0
  let hasGeometry = false

  const includePoint = (x: number, y: number) => {
    hasGeometry = true
    maxDistanceMeters = Math.max(maxDistanceMeters, Math.hypot(x, y))
  }

  for (const plant of scene.plants) includePoint(plant.position.x, plant.position.y)
  for (const zone of scene.zones) {
    for (const point of zone.points) includePoint(point.x, point.y)
  }
  for (const annotation of scene.annotations) includePoint(annotation.position.x, annotation.position.y)
  for (const group of scene.groups) includePoint(group.position.x, group.position.y)

  return hasGeometry ? maxDistanceMeters : null
}

export function precisionSnapshot(scene: ScenePersistedState | null): Pick<
  MapLibreCanvasSurfaceState,
  'precisionWarning' | 'designExtentMeters'
> {
  const designExtentMeters = scene ? computeSceneExtentMeters(scene) : null
  return {
    precisionWarning: designExtentMeters != null && designExtentMeters > LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
    designExtentMeters,
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

export function publishMapDiagnostics(frame: MapFrame | null, designExtentMeters: number | null): void {
  if (!import.meta.env.DEV) return
  ;(globalThis as { __CANOPI_MAP_DEBUG__?: unknown }).__CANOPI_MAP_DEBUG__ = frame
    ? {
      center: frame.center,
      zoom: frame.zoom,
      bearing: frame.bearing,
      viewportCenterWorld: frame.diagnostics.viewportCenterWorld,
      viewportCornerGeo: frame.diagnostics.viewportCornerGeo,
      designExtentMeters,
      precisionWarning: designExtentMeters != null && designExtentMeters > LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
    }
    : null
}
