// canvas/saved-view-framing.ts  (the saved-view framing rule, ADR 0011)
//
// How a stored view frames the map: storing a view records its camera and the ground the whole map shows, in metres in the view's
// turned frame; going to a saved view, a story step, a thumbnail and opening a Design at the view it was saved with all fit that
// ground into their window at the view's bearing with one rule.

import { mapZoomToStageScale } from './projection'
import { roundGeoDegrees, storedBearing, type GeographicView } from './session-plane'
import { WORKSPACE_MAP_MAX_ZOOM, WORKSPACE_MAP_MIN_ZOOM } from './workspace-camera-policy'
import { SAVED_VIEW_MAX_GROUND_SIZE_M, SAVED_VIEW_MAX_ZOOM } from '../generated/canopi-design-format'
import type { SavedViewCamera } from '../types/design'

type GroundSize = NonNullable<SavedViewCamera['ground_size_m']>

/** A window in CSS pixels: the whole map, or a snapshot image. */
interface WindowSize {
  readonly width: number
  readonly height: number
}

/** Zoom steps closer than this to the saved zoom are the saved zoom, so the window a view was saved in gets its exact camera. */
const SAME_ZOOM_TOLERANCE = 1e-6

/**
 * A view as it is stored: its centre rounded to 1e-9°, its zoom to 1e-6 within the format's range, its bearing rounded to 1e-6
 * and folded into [0, 360) (spec §4.10), and the ground `screen` shows measured at that stored camera, so the same window gives
 * back the exact camera. A screen with no size frames no ground, and the view keeps its zoom.
 */
export function savedViewCameraOf(view: GeographicView, screen: WindowSize): SavedViewCamera {
  const lat = roundGeoDegrees(view.lat)
  const zoom = Math.min(SAVED_VIEW_MAX_ZOOM, Math.max(0, Math.round(view.zoom * 1e6) / 1e6))
  const ground = savedViewGroundSize({ lat, zoom }, screen)
  return {
    lon: roundGeoDegrees(view.lon),
    lat,
    zoom,
    bearing: storedBearing(view.bearing),
    ...(ground ? { ground_size_m: ground } : {}),
  }
}

/**
 * The ground a window shows at a stored camera (its rounded centre latitude and zoom), in metres, to ten significant figures,
 * or null when the window has no size or the ground is out of the format's range.
 */
function savedViewGroundSize(camera: Pick<SavedViewCamera, 'lat' | 'zoom'>, window: WindowSize): GroundSize | null {
  const metresPerPixel = groundMetresPerPixel(camera)
  const ground = {
    width: Number((window.width * metresPerPixel).toPrecision(10)),
    height: Number((window.height * metresPerPixel).toPrecision(10)),
  }
  const admitted = [ground.width, ground.height].every((side) => Number.isFinite(side) && side > 0 && side <= SAVED_VIEW_MAX_GROUND_SIZE_M)
  return admitted ? ground : null
}

/**
 * The zoom that fits a saved view's framed ground into `window` at its bearing: the saved zoom when the ground fits already (the
 * same window, or a larger one: never closer than saved), else zoomed out just enough that nothing framed is cut off; within the
 * map's zoom range. A view saved without its ground frames what `workspace` (the whole map now) shows at its camera zoom, so it
 * keeps its zoom in the workspace and a snapshot scales it by the image-to-workspace ratio.
 */
export function savedViewZoom(camera: SavedViewCamera, window: WindowSize, workspace: WindowSize = window): number {
  const ground = camera.ground_size_m ?? savedViewGroundSize(camera, workspace)
  const metresPerPixel = groundMetresPerPixel(camera)
  const step = ground
    ? Math.min(0, Math.log2(Math.min(window.width * metresPerPixel / ground.width, window.height * metresPerPixel / ground.height)))
    : 0
  const zoom = Number.isFinite(step) && Math.abs(step) > SAME_ZOOM_TOLERANCE ? camera.zoom + step : camera.zoom
  return Math.min(WORKSPACE_MAP_MAX_ZOOM, Math.max(WORKSPACE_MAP_MIN_ZOOM, zoom))
}

/** Ground metres per CSS pixel at a stored camera's centre latitude and zoom: a size, never a position. */
function groundMetresPerPixel(camera: Pick<SavedViewCamera, 'lat' | 'zoom'>): number {
  return 1 / mapZoomToStageScale(camera.zoom, camera.lat)
}
