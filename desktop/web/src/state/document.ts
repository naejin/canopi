/**
 * Canonical document API and composition boundary.
 *
 * This module is the long-term document authority boundary. `state/design.ts`
 * is an internal/transitional module that this wraps. External consumers
 * should import from here, not from `design.ts` or `canvas/serializer.ts`.
 */
import type { CanopiFile } from '../types/design'
import type { CanvasEngine } from '../canvas/engine'
import { toCanopi, extractExtra } from '../canvas/serializer'

export { extractExtra }
import { currentDesign } from './design'

// Re-export document signals for external consumers
export {
  designDirty,
  designPath,
  designName,
  currentDesign,
  pendingDesignPath,
  pendingTemplateImport,
  nonCanvasRevision,
  autosaveFailed,
  resetDirtyBaselines,
} from './design'
export {
  consumeQueuedDocumentLoad,
  saveCurrentDesign,
  saveAsCurrentDesign,
  openDesign,
  openDesignAsTemplate,
  openDesignFromPath,
  newDesignAction,
} from './document-actions'

/**
 * Write canvas state back into a CanopiFile, merging with the canonical
 * document for non-canvas sections. Called before save/autosave.
 */
export function writeCanvasIntoDocument(
  engine: CanvasEngine,
  name: string,
): CanopiFile {
  return toCanopi(engine, { name }, currentDesign.value)
}

/**
 * Load a CanopiFile into the canvas engine.
 * Called after opening/creating a design.
 */
export function loadCanvasFromDocument(
  file: CanopiFile,
  engine: CanvasEngine,
): void {
  engine.loadDocument(file)
}
