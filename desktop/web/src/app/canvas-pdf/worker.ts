import { preparePdf, type PdfPreparation } from './prepare'
import { PdfTextError } from './text'
self.onmessage = async (event: MessageEvent<PdfPreparation>) => {
  try {
    const result = await preparePdf(event.data)
    self.postMessage({ result }, { transfer: result.bytes ? [result.bytes.buffer] : [] })
  } catch (error) {
    self.postMessage({ error: error instanceof PdfTextError ? error.kind : 'prepare-failed' })
  }
}
