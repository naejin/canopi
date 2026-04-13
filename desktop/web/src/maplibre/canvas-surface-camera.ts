import {
  createMapFrame,
  type MapFrame,
  type MapLibreCameraLocation,
  type MapLibreCameraScreenSize,
} from '../canvas/maplibre-camera'

export interface MapLibreSurfaceCameraRuntime {
  getViewport(): Parameters<typeof createMapFrame>[0]
  getViewportScreenSize(): MapLibreCameraScreenSize
}

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
