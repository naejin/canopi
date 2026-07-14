import type { CanopiFile } from '../../../types/design'
import type { SceneDocumentReader } from '../scene'
import type {
  CanvasDocumentReplacementReceipt,
  CanvasDocumentReplacementToken,
  CanvasRuntimeDocumentMetadata,
} from '../runtime'
import type {
  CanvasRuntimeDocumentCompositionInput,
} from '../app-adapter'
import type { SceneDocumentAuthority, SceneSavedCheckpoint } from './transactions'

interface SceneRuntimeDocumentBridgeOptions {
  sceneStore: SceneDocumentReader
  authority: SceneDocumentAuthority & SceneSavedCheckpoint
  prepareForDocumentReplacement(): void
  clearHoveredTargets(): void
  clearPanelOriginTargets(): void
  composeDocumentForSave(input: CanvasRuntimeDocumentCompositionInput): CanopiFile
  syncCanvasSignalsFromDocument(file: CanopiFile): void
}

export class SceneRuntimeDocumentBridge {
  private readonly _sceneStore: SceneDocumentReader
  private readonly _authority: SceneRuntimeDocumentBridgeOptions['authority']
  private readonly _prepareForDocumentReplacement: SceneRuntimeDocumentBridgeOptions['prepareForDocumentReplacement']
  private readonly _clearHoveredTargets: SceneRuntimeDocumentBridgeOptions['clearHoveredTargets']
  private readonly _clearPanelOriginTargets: SceneRuntimeDocumentBridgeOptions['clearPanelOriginTargets']
  private readonly _composeDocumentForSave: SceneRuntimeDocumentBridgeOptions['composeDocumentForSave']
  private readonly _syncCanvasSignalsFromDocument: SceneRuntimeDocumentBridgeOptions['syncCanvasSignalsFromDocument']

  constructor(options: SceneRuntimeDocumentBridgeOptions) {
    this._sceneStore = options.sceneStore
    this._authority = options.authority
    this._prepareForDocumentReplacement = options.prepareForDocumentReplacement
    this._clearHoveredTargets = options.clearHoveredTargets
    this._clearPanelOriginTargets = options.clearPanelOriginTargets
    this._composeDocumentForSave = options.composeDocumentForSave
    this._syncCanvasSignalsFromDocument = options.syncCanvasSignalsFromDocument
  }

  loadDocument(file: CanopiFile): void {
    this._clearHoveredTargets()
    this._clearPanelOriginTargets()
    this._authority.hydrate(file, (hydratedFile) => {
      this._syncCanvasSignalsFromDocument(hydratedFile)
    })
  }

  replaceDocument(
    file: CanopiFile,
    token: CanvasDocumentReplacementToken,
    finalizeReplacement: () => void,
  ): CanvasDocumentReplacementReceipt {
    const callerFinalizerInvoked = this._authority.replaceDocument(file, {
      token,
      prepare: () => {
        this._prepareForDocumentReplacement()
        this._clearHoveredTargets()
        this._clearPanelOriginTargets()
      },
      syncDocumentSignals: (hydratedFile) => {
        this._syncCanvasSignalsFromDocument(hydratedFile)
      },
      finalizeReplacement,
    })
    return { callerFinalizerInvoked }
  }

  serializeDocument(metadata: CanvasRuntimeDocumentMetadata, doc: CanopiFile): CanopiFile {
    const canvasOutput = this._sceneStore.toCanopiFile({ now: new Date() })
    return this._composeDocumentForSave({ metadata, document: doc, canvas: canvasOutput })
  }

  markSaved(): void {
    this._authority.markSaved()
  }
}
