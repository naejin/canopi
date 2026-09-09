import PdfWorker from './worker?worker&inline'
import type { PdfPreparation } from './prepare'
import type { PreparedPdf } from './types'
/** A worker is the cancellation boundary for synchronous shaping and encoding. */
export function preparePdfJob(input: PdfPreparation, signal: AbortSignal): Promise<PreparedPdf> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const worker = new PdfWorker()
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate() }
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('prepare-timeout')) }, 120_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ result?: PreparedPdf; error?: string }>) => {
      cleanup()
      if (event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? 'prepare-failed'))
    }
    worker.onerror = () => { cleanup(); reject(new Error('prepare-failed')) }
    try { worker.postMessage(input) } catch (error) { cleanup(); reject(error) }
  })
}
