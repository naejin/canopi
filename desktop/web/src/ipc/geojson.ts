import { invoke } from '@tauri-apps/api/core'
import { message, open, save } from '@tauri-apps/plugin-dialog'
import type {
  GeoJsonFileAdapter,
  GeoJsonNotice,
  GeoJsonSourceFile,
  GeoJsonWriteOutcome,
} from '../app/geojson/workflow'

const GEOJSON_FILTERS = [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }]

/** Desktop GeoJSON file I/O: native dialogs choose the path, Rust reads/writes it. */
export const desktopGeoJsonFiles: GeoJsonFileAdapter = {
  async pickGeoJsonFile(): Promise<GeoJsonSourceFile | null> {
    const selected = await open({ filters: GEOJSON_FILTERS, multiple: false })
    if (!selected) return null
    const path = typeof selected === 'string' ? selected : selected[0]
    if (!path) return null
    const text = await invoke<string>('read_geojson_file', { path })
    return { name: path.split(/[\\/]/).pop() ?? path, text }
  },

  async writeGeoJsonFile(text: string, fileName: string): Promise<GeoJsonWriteOutcome> {
    const path = await save({ defaultPath: fileName, filters: GEOJSON_FILTERS })
    if (!path) return 'cancelled'
    await invoke('export_file', {
      data: text,
      path: /\.(geo)?json$/i.test(path) ? path : `${path}.geojson`,
    })
    return 'written'
  },
}

export async function presentDesktopGeoJsonNotice(notice: GeoJsonNotice): Promise<void> {
  await message(notice.message, {
    title: notice.title,
    kind: notice.tone === 'error' ? 'error' : 'info',
  })
}
