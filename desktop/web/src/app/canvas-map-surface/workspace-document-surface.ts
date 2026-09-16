import {
  CanvasDocumentReplacementNotAdmittedError,
  type CanvasDocumentSurface,
} from '../../canvas/runtime/runtime'
import type { WorkspaceGenerationReconciler } from './workspace-generation-reconciler'

export interface WorkspaceDocumentSurfaceOptions {
  readonly documents: CanvasDocumentSurface
  readonly reconciler: WorkspaceGenerationReconciler
}

/**
 * Fences and reconciles the shared workspace at the app boundary without
 * making Scene document authority aware of MapLibre ownership.
 */
export function createWorkspaceDocumentSurface({
  documents,
  reconciler,
}: WorkspaceDocumentSurfaceOptions): CanvasDocumentSurface {
  const replaceDocument: CanvasDocumentSurface['replaceDocument'] = (
    file,
    token,
    finalizeReplacement,
  ) => {
    const ticket = reconciler.suspendForDocumentReplacement()
    try {
      const receipt = documents.replaceDocument(file, token, finalizeReplacement)
      reconciler.reconcileAfterDocumentReplacement(ticket)
      return receipt
    } catch (error) {
      if (error instanceof CanvasDocumentReplacementNotAdmittedError) {
        reconciler.reconcileAfterDocumentReplacement(ticket)
      }
      throw error
    }
  }

  return new Proxy(documents, {
    get(target, property) {
      if (property === 'replaceDocument') return replaceDocument
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
