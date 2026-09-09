import { resolvePdfCommonNames } from '../plant-browser/live.browser'
import type { PdfDelivery } from './workflow'
export const resolvePdfNames = resolvePdfCommonNames
export function createPdfDelivery(): PdfDelivery {
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  const release = (url: string) => { const timer = pending.get(url); if (timer) clearTimeout(timer); pending.delete(url); URL.revokeObjectURL(url) }
  return {
    async save(bytes, name, signal) {
      if (signal.aborted) return 'cancelled'
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Canopi'}.pdf`
      document.body.appendChild(anchor)
      try { anchor.click() } catch (error) { URL.revokeObjectURL(url); throw error }
      finally { anchor.remove() }
      pending.set(url, setTimeout(() => release(url), 1000))
      return 'downloaded'
    },
    dispose() { for (const url of pending.keys()) release(url) },
  }
}
