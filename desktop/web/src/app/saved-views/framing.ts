// How a saved view frames the map (ADR 0011): saving records the ground the map shows, in metres in the view's turned frame,
// and going to the view, a story step and a thumbnail all fit that ground into their window at the view's bearing with one rule.

import { mapZoomToStageScale } from '../../canvas/projection'
import { WORKSPACE_MAP_MAX_ZOOM, WORKSPACE_MAP_MIN_ZOOM } from '../../canvas/workspace-camera-policy'
import type { SavedView } from '../../types/design'
import { isAdmittedGroundSize } from '../contracts/views-admission'

type SavedViewCamera = SavedView['camera']
type GroundSize = NonNullable<SavedViewCamera['ground_size_m']>

/** A window in CSS pixels: the whole map, or a snapshot image. */
interface WindowSize {
  readonly width: number
  readonly height: number
}

/** Zoom steps closer than this to the saved zoom are the saved zoom, so the window a view was saved in gets its exact camera. */
const SAME_ZOOM_TOLERANCE = 1e-6

/**
 * The ground a window shows at a stored camera (its rounded centre latitude and zoom), in metres, to ten significant figures,
 * or null when the window has no size or the ground is out of range.
 */
export function savedViewGroundSize(camera: Pick<SavedViewCamera, 'lat' | 'zoom'>, window: WindowSize): GroundSize | null {
  const pixelsPerMetre = mapZoomToStageScale(camera.zoom, camera.lat)
  const ground = {
    width: Number((window.width / pixelsPerMetre).toPrecision(10)),
    height: Number((window.height / pixelsPerMetre).toPrecision(10)),
  }
  return isAdmittedGroundSize(ground) ? ground : null
}

/**
 * The zoom that fits a saved view's framed ground into `window` at its bearing: the saved zoom when the ground fits already (the
 * same window, or a larger one: never closer than saved), else zoomed out just enough that nothing framed is cut off; within the
 * map's zoom range. A view saved without its ground frames what `workspace` (the whole map now) shows at its camera zoom, so it
 * keeps its zoom in the workspace and a snapshot scales it by the image-to-workspace ratio.
 */
export function savedViewZoom(camera: SavedViewCamera, window: WindowSize, workspace: WindowSize = window): number {
  const ground = camera.ground_size_m ?? savedViewGroundSize(camera, workspace)
  const metresPerPixel = 1 / mapZoomToStageScale(camera.zoom, camera.lat)
  const step = ground
    ? Math.min(0, Math.log2(Math.min(window.width * metresPerPixel / ground.width, window.height * metresPerPixel / ground.height)))
    : 0
  const zoom = Number.isFinite(step) && Math.abs(step) > SAME_ZOOM_TOLERANCE ? camera.zoom + step : camera.zoom
  return Math.min(WORKSPACE_MAP_MAX_ZOOM, Math.max(WORKSPACE_MAP_MIN_ZOOM, zoom))
}
