import { geographicViewOf } from '../../canvas/session-plane'
import {
  currentCanvasQuerySurface,
  getCurrentCanvasCommandSurface,
} from '../../canvas/session'
import { t } from '../../i18n'
import type { SavedView } from '../../types/design'
import { createUuid } from '../../utils/ids'
import { addSavedView } from '../design-edit'
import { currentDesign } from '../document-session/store'
import { mapLayers } from '../map-layers/state'
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

export function defaultSavedViewName(): string {
  return t('savedViews.defaultName', { number: currentSavedViews().length + 1 })
}

export interface SaveCurrentViewInput {
  readonly name: string
  /** Shown with the view when it is presented; blank means none. */
  readonly title?: string
}

/**
 * Saves what the map shows now as Design Edit data: camera, map background and
 * terrain, visible Design layers and site data, the focused species and the
 * selection, with a name and an optional title.
 */
export function saveCurrentView({ name, title = '' }: SaveCurrentViewInput): SavedView | null {
  const queries = currentCanvasQuerySurface.value
  const plane = queries?.sessionPlane.value
  const design = currentDesign.value
  const trimmed = name.trim()
  if (!queries || !plane || !design || trimmed.length === 0) return null
  const view = geographicViewOf(queries.viewport.value, plane)
  if (!view) return null

  const saved = composeSavedView({
    id: createUuid(),
    name: trimmed,
    title: title.trim() || null,
    view,
    mapLayers: mapLayers.value,
    sceneLayers: queries.getSceneSnapshot().layers,
    siteData: design.lidar?.entries ?? [],
    focusedSpecies: queries.getSpeciesFocus().canonicalName,
    selection: queries.getSelection(),
  })
  addSavedView(saved)
  return saved
}

export interface GoToSavedViewOptions {
  /** Jump instead of flying; defaults to the platform reduced-motion preference. */
  readonly reducedMotion?: boolean
}

/**
 * Goes to a saved view: session state only, never a Design edit. The camera
 * flies there (or jumps under reduced motion); objects never move. Background,
 * layer and highlight overrides belong to presenting a story, which applies
 * them on top of this and restores the user's state when it ends.
 */
export function goToSavedView(id: string, options: GoToSavedViewOptions = {}): boolean {
  const view = currentSavedViews().find((entry) => entry.id === id)
  const commands = getCurrentCanvasCommandSurface()
  if (!view || !commands || !canShowSavedViews()) return false
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion()
  return commands.viewport.showPlace(
    { lon: view.camera.lon, lat: view.camera.lat },
    view.camera.zoom,
    { motion: reducedMotion ? 'jump' : 'fly' },
  )
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
