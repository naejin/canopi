import { mutateSettingsProjection } from '../settings/projection'
import type { WorkspaceSettledView } from './workspace-runtime-composition'

/** Remembers the settled view as the app's last view (D4: new Designs open there). */
export function persistLastView(view: WorkspaceSettledView): void {
  mutateSettingsProjection((settings) => {
    settings.lastView = { lon: view.lon, lat: view.lat, zoom: view.zoom }
  }, { persist: 'queued' })
}
