import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { getCommonNames } from '../../ipc/species'
import type { PdfDelivery } from './workflow'
export const resolvePdfNames = (names: readonly string[], locale: string) => getCommonNames([...names], locale)
export function createPdfDelivery(): PdfDelivery {
  return {
    async save(bytes, name, signal) {
      const path = await save({ defaultPath: `${safeName(name)}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
      if (!path || signal.aborted) return 'cancelled'
      await invoke('save_canvas_pdf', { data: Array.from(bytes), path: /\.pdf$/i.test(path) ? path : `${path}.pdf` })
      return 'saved'
    },
    dispose() {},
  }
}
function safeName(name: string): string { return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Canopi' }
