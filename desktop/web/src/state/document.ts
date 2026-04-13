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
