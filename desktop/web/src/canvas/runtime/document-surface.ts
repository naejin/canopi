import type { CanopiFile } from '../../types/design'
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
import type { ScenePersistedState } from './scene'
import { sceneExtentPoints } from './scene-extent'
import type { SceneRuntimeChromeCoordinator } from './scene-runtime/chrome-coordinator'
import type { SceneRuntimeDocumentBridge } from './scene-runtime/document'
import type { SceneRuntimeRenderScheduler } from './scene-runtime/render-scheduler'
import { runCanvasRuntimeCleanups } from './cleanup'
import type { CanvasInspectionHandle } from '../inspection'
import type { SceneCanvasInspectionOwner } from './inspection-lens'
import type { CameraDriverHost } from './view/camera-driver'
import type { ViewNavigation } from './view/navigation'

interface SceneCanvasDocumentSurfaceOptions {
  readonly readEmptySceneScale?: () => number
  readonly inspection: Pick<SceneCanvasInspectionOwner, 'mount' | 'reset' | 'dispose'>
  readonly documents: Pick<
    SceneRuntimeDocumentBridge,
    'loadDocument' | 'replaceDocument' | 'captureForPersistence'
  >
  /** The runtime's camera: a resize reaches its live driver. */
  readonly cameraHost: Pick<CameraDriverHost, 'frames' | 'current'>
  readonly viewNavigation: Pick<ViewNavigation, 'zoomToFit' | 'clearTemporaryFocus'>
  readonly chrome: Pick<SceneRuntimeChromeCoordinator, 'attach' | 'show' | 'hide' | 'destroy'>
  readonly rendering: Pick<SceneRuntimeRenderScheduler, 'container' | 'invalidate' | 'resize' | 'dispose'>
  readonly getSceneSnapshot: () => ScenePersistedState
  readonly createPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly invalidateViewport: () => void
  readonly renderChrome: () => void
  readonly addGuide: (axis: 'h' | 'v', worldPosition: number) => void
  readonly clearHoveredEntity: () => void
  readonly disposeRuntime: () => void
  readonly disposeInteraction: () => void
  readonly disposeCamera: () => void
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

  attachInspectionTo(element: HTMLElement): CanvasInspectionHandle {
    return this.options.inspection.mount(element)
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
    const scene = this.options.getSceneSnapshot()
    const pixelsPerMetre = this.options.cameraHost.frames.viewFrame.peek().view.pixelsPerMetre
    this.options.viewNavigation.zoomToFit(scene, {
      extentPoints: sceneExtentPoints(scene, this.options.createPlantPresentationContext(pixelsPerMetre)),
      emptySceneScale: this.options.readEmptySceneScale?.(),
    })
    this.options.invalidateViewport()
  }

  loadDocument(file: CanopiFile): void {
    const previousDocumentState = this._documentState
    this._documentState = 'settling'
    try {
      this.options.documents.loadDocument(file)
    } catch (error) {
      // Refused before touching the Scene (an edit still owns it): the
      // previous document is intact and stays saveable.
      if (error instanceof CanvasAuthorityBusyError) this._documentState = previousDocumentState
      throw error
    }
    this._documentState = 'loaded'
    this.options.viewNavigation.clearTemporaryFocus()
    this.options.inspection.reset()
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
      this.options.viewNavigation.clearTemporaryFocus()
      this.options.inspection.reset()
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
    this.options.cameraHost.current().setScreen({ width, height, devicePixelRatio: window.devicePixelRatio })
    this.options.rendering.resize(width, height)
  }

  destroy(): void {
    runCanvasRuntimeCleanups([
      () => this.options.inspection.dispose(),
      () => this.options.disposeRuntime(),
      () => this.options.clearHoveredEntity(),
      () => this.options.disposeInteraction(),
      () => this.options.chrome.destroy(),
      () => this.options.disposeEffects(),
      () => this.options.disposeCamera(),
      () => this.options.rendering.dispose(),
    ], 'Scene Canvas document surface disposal failed')
  }
}
