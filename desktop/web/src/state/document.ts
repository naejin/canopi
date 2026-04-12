/**
 * Canonical document API and composition boundary.
 *
 * This module is the long-term document authority boundary. `state/design.ts`
 * is an internal/transitional module that this wraps. External consumers
 * should import from here, not from `design.ts` or deleted legacy canvas
 * persistence helpers.
 */
import type { CanopiFile } from '../types/design'
import type { CanvasRuntime } from '../canvas/runtime/runtime'
import { extractExtra } from './document-extra'
import { replaceCurrentDesignSnapshot } from './document-mutations'
import { installConsortiumSync, disposeConsortiumSync } from './consortium-sync-workflow'

export { extractExtra, installConsortiumSync }
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
  session: CanvasRuntime,
  name: string,
): CanopiFile {
  const doc = currentDesign.value
  if (!doc) throw new Error('writeCanvasIntoDocument: no design loaded')
  return session.serializeDocument({ name }, doc)
}

export function snapshotCanvasIntoCurrentDocument(
  session: CanvasRuntime,
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
  session: CanvasRuntime,
): void {
  session.loadDocument(file)
  session.zoomToFit()
  installConsortiumSync()
}

export function disposeDocumentWorkflows(): void {
  disposeConsortiumSync()
}
