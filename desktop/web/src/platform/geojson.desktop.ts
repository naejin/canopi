import { message } from '@tauri-apps/plugin-dialog'
import { designName } from '../app/document-session/store'
import { createGeoJsonWorkflow, type GeoJsonNotice } from '../app/geojson/workflow'
import { desktopGeoJsonFiles } from '../ipc/geojson'

/** Desktop presents GeoJSON import and export notices as native message dialogs. */
export async function presentDesktopGeoJsonNotice(notice: GeoJsonNotice): Promise<void> {
  await message(notice.message, {
    title: notice.title,
    kind: notice.tone === 'error' ? 'error' : 'info',
  })
}

/** The Desktop GeoJSON workflow: native file transport plus native notices. */
export const desktopGeoJsonWorkflow = createGeoJsonWorkflow({
  files: desktopGeoJsonFiles,
  notify: presentDesktopGeoJsonNotice,
  designName: () => designName.value,
})
