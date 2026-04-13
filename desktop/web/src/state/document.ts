/**
 * Canonical document API and composition boundary.
 * New document-session policy lives under app/document-session, while
 * state/design remains the low-level signal store.
 */
export { extractDocumentExtra as extractExtra } from "../app/contracts/document";
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
} from "./design";
export {
  consumeQueuedDocumentLoad,
  saveCurrentDesign,
  saveAsCurrentDesign,
  openDesign,
  openDesignAsTemplate,
  openDesignFromPath,
  newDesignAction,
} from "../app/document-session/actions";
export {
  installConsortiumSync,
  writeCanvasIntoDocument,
  snapshotCanvasIntoCurrentDocument,
  loadCanvasFromDocument,
  disposeDocumentWorkflows,
} from "../app/document-session/runtime";
