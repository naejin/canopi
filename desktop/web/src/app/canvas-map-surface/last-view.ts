import { mutateSettingsProjection } from '../settings/projection'
import type { WorkspaceSettledView } from './workspace-runtime-composition'

/**
 * The closest a new or empty Design opens: about one country wide, so "Where
 * is your site?" appears over an overview, never at the previous Design's
 * site scale.
 */
export const NEW_DESIGN_OVERVIEW_MAX_ZOOM = 5

/** Remembers the settled view as the app's last view. */
export function persistLastView(view: WorkspaceSettledView): void {
  mutateSettingsProjection((settings) => {
    settings.lastView = { lon: view.lon, lat: view.lat, zoom: view.zoom }
  }, { persist: 'queued' })
}

/**
 * Where a new or empty Design opens: the last view's centre, zoomed out to at
 * most country level; null (the world default) when there is no last view.
 */
export function newDesignViewFrom(
  last: WorkspaceSettledView | null,
): WorkspaceSettledView | null {
  if (!last) return null
  return { lon: last.lon, lat: last.lat, zoom: Math.min(last.zoom, NEW_DESIGN_OVERVIEW_MAX_ZOOM) }
}
