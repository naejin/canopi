// maplibre/canvas-surface-camera.ts
//
// Owns the map contributions' dev diagnostics of the camera (spec §1.1 ViewDiagnostics): the settled camera, the ground under
// the screen centre in plane metres and the ground under the four screen corners. Development builds only, like their one
// consumer (publishMapDiagnostics); the contribution adapters subscribe to the settled camera themselves.

import type { CanvasQuerySurface } from '../canvas/runtime/runtime'
import { screenToGeo } from '../canvas/runtime/view/camera-math'
import type { GeoPoint, ViewDiagnostics } from '../canvas/runtime/view/types'

export type MapLibreSurfaceCameraRuntime = Pick<CanvasQuerySurface, 'view' | 'sessionPlane'>

/**
 * Null in production builds, without a Design plane or on an empty screen. The screen is the live frame's (captureView is the read
 * surface's one screen read), which is the settled camera's unless the screen changed since.
 */
export function resolveMapLibreSurfaceDiagnostics(
  runtime: MapLibreSurfaceCameraRuntime | null,
): ViewDiagnostics | null {
  if (!runtime || !import.meta.env.DEV) return null
  const plane = runtime.sessionPlane.value
  const camera = runtime.view.settledCamera.value
  if (!plane) return null
  const { screen } = runtime.view.captureView()
  if (!(screen.width > 0 && screen.height > 0)) return null
  const corner = (x: number, y: number): GeoPoint => screenToGeo(camera, screen, { x, y })
  return {
    camera,
    centreWorld: plane.toPlane(camera.center),
    groundQuadGeo: [corner(0, 0), corner(screen.width, 0), corner(screen.width, screen.height), corner(0, screen.height)],
  }
}
