import {
  createMapFrame,
  type MapFrame,
  type MapLibreCameraLocation,
} from '../canvas/maplibre-camera'
import type { CanvasQuerySurface } from '../canvas/runtime/runtime'

export type MapLibreSurfaceCameraRuntime = Pick<
  CanvasQuerySurface,
  'getViewport' | 'getViewportScreenSize'
>

export interface MapLibreSurfaceCameraMap {
  jumpTo(options: { center: [number, number]; zoom: number; bearing: number }): void
}

export function resolveMapLibreSurfaceFrame(
  runtime: MapLibreSurfaceCameraRuntime | null,
  location: MapLibreCameraLocation | null,
  bearing: number | null,
): MapFrame | null {
  if (!runtime || !location) return null

  return createMapFrame(
    runtime.getViewport(),
    runtime.getViewportScreenSize(),
    location,
    bearing,
  )
}

export function applyMapLibreSurfaceCamera(
  map: MapLibreSurfaceCameraMap,
  runtime: MapLibreSurfaceCameraRuntime | null,
  location: MapLibreCameraLocation | null,
  bearing: number | null,
): MapFrame | null {
  const frame = resolveMapLibreSurfaceFrame(runtime, location, bearing)
  if (!frame) return null

  map.jumpTo({
    center: [frame.center[0], frame.center[1]],
    zoom: frame.zoom,
    bearing: frame.bearing,
  })
  return frame
}
