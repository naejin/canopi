import type { CanopiFile } from '../../types/design'
import type { CameraController } from './camera'
import type { PlantPresentationContext } from './plant-presentation'
import {
  CanvasAuthorityBusyError,
  CanvasDocumentReplacementNotAdmittedError,
  type CanvasDocumentReplacementReceipt,
  type CanvasDocumentReplacementToken,
  type CanvasDocumentSurface,
  type CanvasPersistenceCapture,
  type CanvasRuntimeDocumentMetadata,
} from './runtime'
import type { ScenePersistedState, SceneViewportState } from './scene'
import type { SceneRuntimeChromeCoordinator } from './scene-runtime/chrome-coordinator'
import type { SceneRuntimeDocumentBridge } from './scene-runtime/document'
import type { SceneRuntimeRenderScheduler } from './scene-runtime/render-scheduler'
import { runCanvasRuntimeCleanups } from './cleanup'

interface SceneCanvasDocumentSurfaceOptions {
  readonly documents: Pick<
    SceneRuntimeDocumentBridge,
    'loadDocument' | 'replaceDocument' | 'captureForPersistence'
  >
  readonly camera: Pick<CameraController, 'initialize' | 'resize' | 'zoomToFit' | 'viewport'>
  readonly chrome: Pick<SceneRuntimeChromeCoordinator, 'attach' | 'show' | 'hide' | 'destroy'>
  readonly rendering: Pick<SceneRuntimeRenderScheduler, 'container' | 'invalidate' | 'resize' | 'dispose'>
  readonly getSceneSnapshot: () => ScenePersistedState
  readonly createPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly setViewport: (
    viewport: SceneViewportState,
    options?: { forceRevision?: boolean },
  ) => void
  readonly invalidateViewport: () => void
  readonly renderChrome: () => void
  readonly addGuide: (axis: 'h' | 'v', worldPosition: number) => void
  readonly clearHoveredEntity: () => void
  readonly disposeRuntime: () => void
  readonly disposeInteraction: () => void
  readonly disposeEffects: () => void
}

export function createSceneCanvasDocumentSurface(
  options: SceneCanvasDocumentSurfaceOptions,
): CanvasDocumentSurface {
  return new SceneCanvasDocumentRole(options)
}

class SceneCanvasDocumentRole implements CanvasDocumentSurface {
  private _documentState: 'absent' | 'settling' | 'loaded' = 'absent'

  constructor(private readonly options: SceneCanvasDocumentSurfaceOptions) {}

  initializeViewport(): void {
    const container = this.options.rendering.container
    if (!container) return
    const viewport = this.options.camera.initialize({
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
    })
    this.options.setViewport(viewport, { forceRevision: true })
    this.options.rendering.invalidate('scene')
  }

  attachRulersTo(element: HTMLElement): void {
    this.options.chrome.attach(element, (axis, worldPosition) => {
      this.options.addGuide(axis, worldPosition)
    })
    this.options.renderChrome()
  }

  showCanvasChrome(): void {
    this.options.chrome.show()
    this.options.renderChrome()
  }

  hideCanvasChrome(): void {
    this.options.chrome.hide()
    this.options.renderChrome()
  }

  zoomToFit(): void {
    const viewport = this.options.camera.zoomToFit(this.options.getSceneSnapshot(), {
      plantContext: this.options.createPlantPresentationContext(this.options.camera.viewport.scale),
    })
    this.options.setViewport(viewport)
    this.options.invalidateViewport()
  }

  loadDocument(file: CanopiFile): void {
    this._documentState = 'settling'
    this.options.documents.loadDocument(file)
    this._documentState = 'loaded'
  }

  replaceDocument(
    file: CanopiFile,
    token: CanvasDocumentReplacementToken,
    finalizeReplacement: () => void,
  ): CanvasDocumentReplacementReceipt {
    const previousDocumentState = this._documentState
    this._documentState = 'settling'
    try {
      const receipt = this.options.documents.replaceDocument(file, token, finalizeReplacement)
      this._documentState = 'loaded'
      return receipt
    } catch (error) {
      if (error instanceof CanvasDocumentReplacementNotAdmittedError) {
        this._documentState = previousDocumentState
      }
      throw error
    }
  }

  hasLoadedDocument(): boolean {
    return this._documentState !== 'absent'
  }

  captureForPersistence(
    metadata: CanvasRuntimeDocumentMetadata,
    doc: CanopiFile,
  ): CanvasPersistenceCapture {
    if (this._documentState === 'settling') {
      throw new CanvasAuthorityBusyError('document-settlement')
    }
    return this.options.documents.captureForPersistence(metadata, doc)
  }

  resize(width: number, height: number): void {
    this.options.setViewport(this.options.camera.resize({ width, height }), { forceRevision: true })
    this.options.rendering.resize(width, height)
  }

  destroy(): void {
    runCanvasRuntimeCleanups([
      () => this.options.disposeRuntime(),
      () => this.options.clearHoveredEntity(),
      () => this.options.disposeInteraction(),
      () => this.options.chrome.destroy(),
      () => this.options.disposeEffects(),
      () => this.options.rendering.dispose(),
    ], 'Scene Canvas document surface disposal failed')
  }
}
