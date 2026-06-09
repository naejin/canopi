import type { CanvasDocumentSurface } from './runtime'
import type { SceneCanvasRuntime } from './scene-runtime'

export function createSceneCanvasDocumentSurface(runtime: SceneCanvasRuntime): CanvasDocumentSurface {
  return new SceneCanvasDocumentRole(runtime)
}

class SceneCanvasDocumentRole implements CanvasDocumentSurface {
  constructor(private readonly runtime: SceneCanvasRuntime) {}

  initializeViewport(): void { this.runtime.initializeViewport() }
  attachRulersTo(element: HTMLElement): void { this.runtime.attachRulersTo(element) }
  showCanvasChrome(): void { this.runtime.showCanvasChrome() }
  hideCanvasChrome(): void { this.runtime.hideCanvasChrome() }
  zoomToFit(): void { this.runtime.zoomToFit() }
  loadDocument(file: Parameters<CanvasDocumentSurface['loadDocument']>[0]): void {
    this.runtime.loadDocument(file)
  }
  replaceDocument(file: Parameters<CanvasDocumentSurface['replaceDocument']>[0]): void {
    this.runtime.replaceDocument(file)
  }
  hasLoadedDocument(): boolean { return this.runtime.hasLoadedDocument() }
  serializeDocument(
    metadata: Parameters<CanvasDocumentSurface['serializeDocument']>[0],
    doc: Parameters<CanvasDocumentSurface['serializeDocument']>[1],
  ) {
    return this.runtime.serializeDocument(metadata, doc)
  }
  markSaved(): void { this.runtime.markSaved() }
  clearHistory(): void { this.runtime.clearHistory() }
  resize(width: number, height: number): void { this.runtime.resize(width, height) }
  destroy(): void { this.runtime.destroy() }
}
