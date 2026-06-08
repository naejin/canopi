import type { CanvasRuntimeAppAdapter } from '../../canvas/runtime/app-adapter'
import { composeDocumentForSave } from '../contracts/document'
import { setCanvasClean } from '../document-session/store'

export function createAppCanvasRuntimeAppAdapter(): CanvasRuntimeAppAdapter {
  return {
    cleanState: { setCanvasClean },
    document: { composeDocumentForSave },
  }
}
