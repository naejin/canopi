import * as designState from '../../state/design'

// Test-only adapter for Design Session implementation state.
// Production code must use app/document-session/store instead.
export const currentDesign = designState.currentDesign
export const designPath = designState.designPath
export const designName = designState.designName
export const pendingDesignPath = designState.pendingDesignPath
export const pendingTemplateImport = designState.pendingTemplateImport

export const nonCanvasRevision = designState.nonCanvasRevision
export const nonCanvasSavedRevision = designState.nonCanvasSavedRevision
export const autosaveFailed = designState.autosaveFailed
export const canvasClean = designState.canvasClean
export const detachedCanvasDirty = designState.detachedCanvasDirty
export const canvasDirty = designState.canvasDirty
export const designDirty = designState.designDirty

export const resetDirtyBaselines = designState.resetDirtyBaselines
export function markSaved(): void {
  designState.detachedCanvasDirty.value = false
  designState.canvasClean.value = true
  designState.nonCanvasSavedRevision.value = designState.nonCanvasRevision.value
  designState.autosaveFailed.value = false
}
export const markCanvasDetachedDirty = designState.markCanvasDetachedDirty
export const replaceCurrentDesignState = designState.replaceCurrentDesignState
