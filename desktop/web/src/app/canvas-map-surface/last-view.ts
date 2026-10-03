import { mutateSettingsProjection } from '../settings/projection'
import type { WorkspaceSettledView } from './workspace-runtime-composition'

/** Remembers the settled view, its bearing included, as the app's last view (per device; spec §4.15). */
export function persistLastView(view: WorkspaceSettledView): void {
  mutateSettingsProjection((settings) => {
    settings.lastView = { lon: view.lon, lat: view.lat, zoom: view.zoom, bearing: view.bearing }
  }, { persist: 'queued' })
}
