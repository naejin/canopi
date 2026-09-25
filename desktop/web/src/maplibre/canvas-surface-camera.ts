import {
  createMapFrame,
  type MapFrame,
  type MapLibreCameraLocation,
} from '../canvas/maplibre-camera'
import type { CanvasQuerySurface } from '../canvas/runtime/runtime'

export type MapLibreSurfaceCameraRuntime = Pick<
  CanvasQuerySurface,
  'viewport'
>

export function resolveMapLibreSurfaceFrame(
  runtime: MapLibreSurfaceCameraRuntime | null,
  location: MapLibreCameraLocation | null,
): MapFrame | null {
  if (!runtime || !location) return null
  const snapshot = runtime.viewport.value

  return createMapFrame(
    snapshot.viewport,
    snapshot.screenSize,
    location,
  )
}
