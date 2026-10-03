// The current-view seam shared by saved views and stories: whether views can
// be shown, what the map shows now as a view, and going to a view (camera only).

import { extentOnOneWorld, geographicViewOfCamera, mapZoomToFitExtent } from '../../canvas/session-plane'
import { WORKSPACE_MAP_MAX_ZOOM, WORKSPACE_MAP_MIN_ZOOM } from '../../canvas/workspace-camera-policy'
import {
  currentCanvasQuerySurface,
  getCurrentCanvasCommandSurface,
} from '../../canvas/session'
import type { SavedView } from '../../types/design'
import { currentDesign } from '../document-session/store'
import { mapLayers } from '../map-layers/state'
import { currentPlantDisplay } from '../plant-display/state'
import type { PlantLabelMode } from '../../canvas/runtime/plant-display'
import { reducedMotionPreference } from '../canvas-runtime/app-adapter'
import { composeSavedView } from './model'

/** The views of the open Design, in saved order. */
export function currentSavedViews(): readonly SavedView[] {
  return currentDesign.value?.views ?? []
}

/** A view can be saved or shown while a Design is open on a map with a settled frame. */
export function canShowSavedViews(): boolean {
  const queries = currentCanvasQuerySurface.value
  return currentDesign.value !== null && queries?.sessionPlane.value != null
}

/** What the map shows now as a saved view, with the labels it shows; null without a Design on a map. */
interface CurrentViewCapture {
  readonly view: SavedView
  readonly labels: PlantLabelMode
}

/**
 * Captures what the map shows now as a view (not yet saved): camera and the
 * ground on screen, map background and terrain, visible Design layers and site
 * data, the focused species, the selection and the plant label choice.
 */
export function captureCurrentView({ id, name, title = '' }: {
  readonly id: string
  readonly name: string
  readonly title?: string
}): CurrentViewCapture | null {
  const queries = currentCanvasQuerySurface.value
  const plane = queries?.sessionPlane.value
  const design = currentDesign.value
  const trimmed = name.trim()
  if (!queries || !plane || !design || trimmed.length === 0) return null
  // What is on screen now: the live frame, not the settled camera.
  const capture = queries.view.captureView()
  const view = geographicViewOfCamera(capture.camera)
  if (!view) return null
  return {
    view: composeSavedView({
      id,
      name: trimmed,
      title: title.trim() || null,
      view,
      extent: extentOnOneWorld(capture.extent),
      mapLayers: mapLayers.value,
      sceneLayers: queries.getSceneSnapshot().layers,
      siteData: design.lidar?.entries ?? [],
      focusedSpecies: queries.getSpeciesFocus().canonicalName,
      selection: queries.getSelection(),
    }),
    labels: currentPlantDisplay.peek().labels,
  }
}

interface GoToSavedViewOptions {
  /** Jump instead of flying; defaults to the platform reduced-motion preference. */
  readonly reducedMotion?: boolean
}

/**
 * Goes to a saved view: session state only, never a Design edit. The camera
 * flies there (or jumps under reduced motion) and frames the ground recorded
 * with the view in the current window; objects never move. Background,
 * layer and highlight overrides belong to presenting a story, which applies
 * them on top of this and restores the user's state when it ends.
 */
export function goToSavedView(id: string, options: GoToSavedViewOptions = {}): boolean {
  const view = currentSavedViews().find((entry) => entry.id === id)
  const commands = getCurrentCanvasCommandSurface()
  if (!view || !commands || !canShowSavedViews()) return false
  const reducedMotion = options.reducedMotion ?? reducedMotionPreference().peek()
  const screen = currentCanvasQuerySurface.peek()?.view.captureView().screen
  return commands.viewport.showPlace(
    { lon: view.camera.lon, lat: view.camera.lat },
    savedViewZoomFor(view, screen),
    { motion: reducedMotion ? 'jump' : 'fly' },
  )
}

/**
 * The zoom that shows a view in a frame: its recorded ground fitted to the
 * frame, or its saved zoom for a view without one, within the map's range.
 */
export function savedViewZoomFor(
  view: Pick<SavedView, 'camera' | 'extent'>,
  size: { readonly width: number; readonly height: number } | undefined,
): number {
  const fitted = view.extent && size ? mapZoomToFitExtent(view.extent, size) : null
  return Math.min(WORKSPACE_MAP_MAX_ZOOM, Math.max(WORKSPACE_MAP_MIN_ZOOM, fitted ?? view.camera.zoom))
}
