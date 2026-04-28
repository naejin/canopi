import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import type { CanopiFile } from "../../types/design";
import { currentDesign } from "../../state/design";
import { replaceCurrentDesignSnapshot } from "./snapshot";
import { disposeConsortiumSync, installConsortiumSync } from "./workflows";

export { installConsortiumSync };

export function buildPersistedDocumentContent(
  session: CanvasDocumentSurface | null,
  name: string,
): CanopiFile {
  if (session) {
    const design = currentDesign.value;
    if (!design) throw new Error("buildPersistedDocumentContent: no design loaded");
    return session.serializeDocument({ name }, design);
  }

  const design = currentDesign.value;
  if (!design) throw new Error("No design loaded");
  return {
    ...design,
    name,
  };
}

/**
 * Write canvas state back into a CanopiFile, merging with the canonical
 * document for non-canvas sections. Called before save/autosave.
 */
export function writeCanvasIntoDocument(
  session: CanvasDocumentSurface,
  name: string,
): CanopiFile {
  const design = currentDesign.value;
  if (!design) throw new Error("writeCanvasIntoDocument: no design loaded");
  return session.serializeDocument({ name }, design);
}

export function snapshotCanvasIntoCurrentDocument(
  session: CanvasDocumentSurface,
  name: string,
): CanopiFile | null {
  if (!currentDesign.value) return null;
  const file = writeCanvasIntoDocument(session, name);
  replaceCurrentDesignSnapshot(file);
  return file;
}

/**
 * Load a CanopiFile into the canvas engine.
 * Called after opening/creating a design.
 */
export function loadCanvasFromDocument(
  file: CanopiFile,
  session: CanvasDocumentSurface,
): void {
  session.loadDocument(file);
  session.zoomToFit();
  installConsortiumSync();
}

export function disposeDocumentWorkflows(): void {
  disposeConsortiumSync();
}
