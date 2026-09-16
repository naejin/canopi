import type { CanvasDocumentSurface } from '../../canvas/runtime/runtime'

export interface WorkspaceGenerationDisconnect {
  requestGenerationDisconnect(): Promise<void>
}

export interface WorkspaceDocumentSurfaceOptions {
  readonly documents: CanvasDocumentSurface
  readonly workspace: WorkspaceGenerationDisconnect
}

/**
 * Adds the shared-workspace replacement fence at the app boundary without
 * making Scene document authority aware of MapLibre ownership.
 */
export function createWorkspaceDocumentSurface({
  documents,
  workspace,
}: WorkspaceDocumentSurfaceOptions): CanvasDocumentSurface {
  const replaceDocument: CanvasDocumentSurface['replaceDocument'] = (
    file,
    token,
    finalizeReplacement,
  ) => {
    workspace.requestGenerationDisconnect()
    return documents.replaceDocument(file, token, finalizeReplacement)
  }

  return new Proxy(documents, {
    get(target, property) {
      if (property === 'replaceDocument') return replaceDocument
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
