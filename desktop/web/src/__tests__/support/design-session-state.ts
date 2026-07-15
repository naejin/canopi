import {
  createDesignSessionStoreTestFixture,
  designSessionStore,
  type DesignSessionStoreTestState,
} from '../../app/document-session/store'
import type { CanopiFile } from '../../types/design'

// Test-only adapter for the real Design Session store authority.
// Production code must use app/document-session/store directly.
const fixture = createDesignSessionStoreTestFixture(designSessionStore)

export const currentDesign = designSessionStore.currentDesign
export const designPath = designSessionStore.designPath
export const designName = designSessionStore.designName
export const pendingDesignPath = fixture.pendingDesignPath
export const pendingTemplateImport = fixture.pendingTemplateImport

export const nonCanvasRevision = fixture.nonCanvasRevision
export const nonCanvasSavedRevision = fixture.nonCanvasSavedRevision
export const persistenceDiverged = fixture.persistenceDiverged
export const autosaveFailed = designSessionStore.autosaveFailed
export const canvasClean = fixture.canvasClean
export const detachedCanvasDirty = fixture.detachedCanvasDirty
export const canvasDirty = designSessionStore.canvasDirty
export const designDirty = designSessionStore.designDirty

export const designSessionFixture = {
  set file(file: CanopiFile | null) {
    fixture.setState({ file })
  },
  set path(path: string | null) {
    fixture.setState({ path })
  },
  set name(name: string) {
    fixture.setState({ name })
  },
  set pendingDesignPath(path: string | null) {
    fixture.setState({ pendingDesignPath: path })
  },
  set pendingTemplateImport(
    template: DesignSessionStoreTestState['pendingTemplateImport'],
  ) {
    fixture.setState({ pendingTemplateImport: template })
  },
  set nonCanvasRevision(revision: number) {
    fixture.setState({ nonCanvasRevision: revision })
  },
  set nonCanvasSavedRevision(revision: number) {
    fixture.setState({ nonCanvasSavedRevision: revision })
  },
  set persistenceDiverged(diverged: boolean) {
    fixture.setState({ persistenceDiverged: diverged })
  },
  set autosaveFailed(failed: boolean) {
    fixture.setState({ autosaveFailed: failed })
  },
  set canvasClean(clean: boolean) {
    fixture.setState({ canvasClean: clean })
  },
  set detachedCanvasDirty(dirty: boolean) {
    fixture.setState({ detachedCanvasDirty: dirty })
  },
}

export function resetDesignSessionState(
  initial?: DesignSessionStoreTestState,
): void {
  fixture.reset(initial)
}

export const resetDirtyBaselines = () => designSessionStore.resetDirtyBaselines()
export const markSaved = () => fixture.markSaved()
export const markCanvasDetachedDirty = (dirty: boolean) =>
  designSessionStore.markCanvasDetachedDirty(dirty)
export const replaceCurrentDesignState = (
  file: CanopiFile,
  path: string | null,
  name: string,
) => designSessionStore.replaceCurrentDesignState(file, path, name)
