/**
 * Canonical document API and composition boundary.
 *
 * This module is the long-term document authority boundary. `state/design.ts`
 * is an internal/transitional module that this wraps. External consumers
 * should import from here, not from `design.ts` or deleted legacy canvas
 * persistence helpers.
 */
import type { CanopiFile } from '../types/design'
import type { CanvasSession } from '../canvas/session'
import { extractExtra } from './document-extra'
import { replaceCurrentDesignSnapshot } from './document-mutations'

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
  session: CanvasSession,
  name: string,
): CanopiFile {
  return session.serializeDocument({ name }, currentDesign.value)
}

export function snapshotCanvasIntoCurrentDocument(
  session: CanvasSession,
  name: string,
): CanopiFile | null {
  if (!currentDesign.value) return null
  const file = writeCanvasIntoDocument(session, name)
  replaceCurrentDesignSnapshot(file)
  return file
}

/**
 * Load a CanopiFile into the canvas engine.
 * Called after opening/creating a design.
 */
export function loadCanvasFromDocument(
  file: CanopiFile,
  session: CanvasSession,
): void {
  session.loadDocument(file)
}
