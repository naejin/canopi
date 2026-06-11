import { signal } from '@preact/signals'
import {
  createDetachedCanvasRuntimeAppAdapter,
  type CanvasRuntimeAppAdapter,
} from './app-adapter'
import { setCanvasSelection } from '../session-state'
import { syncPlantSpeciesColorDefaults } from '../plant-species-color-defaults'
import { refreshCanvasColorCache } from '../theme-refresh'
import { createUuid } from '../../utils/ids'
import { CameraController } from './camera'
import { SceneInteractionController } from './scene-interaction'
import { createSceneCanvasCommandSurface } from './command-surface'
import { RendererHost } from './renderers'
import { createCanvas2DSceneRenderer } from './renderers/canvas2d-scene'
import { createPixiSceneRenderer } from './renderers/pixi-scene'
import type { SceneRendererContext, SceneRendererInstance } from './renderers/scene-types'
import { SceneStore } from './scene'
import {
  resetTransientRuntimeState,
  syncCanvasSignalsFromDocument,
  syncCanvasSignalsFromScene,
  syncGuideSignalsFromScene,
  syncPresentationSignalsFromSceneSession,
} from './scene-runtime/scene-sync'
import { SceneRuntimeChromeCoordinator } from './scene-runtime/chrome-coordinator'
import { SceneRuntimeDocumentBridge } from './scene-runtime/document'
import { createSceneCanvasDocumentSurface } from './document-surface'
import { createSceneCanvasQuerySurface } from './query-surface'
import { installSceneRuntimeEffects } from './scene-runtime/effects'
import { SceneRuntimeRenderScheduler, type SceneRuntimeRenderKind } from './scene-runtime/render-scheduler'
import type { ScenePersistedState } from './scene'
import { SceneHistory } from './scene-history'
import { SceneRuntimeMutationController } from './scene-runtime/mutations'
import { SceneRuntimePresentationController } from './scene-runtime/presentation'
import {
  SceneRuntimeEditCoordinator,
  type SceneEditCoordinator,
} from './scene-runtime/transactions'
import {
  createDetachedSceneRuntimePanelTargetAdapter,
  type SceneRuntimePanelTargetAdapter,
} from './scene-runtime/panel-target-adapter'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasQueryRevision,
} from './runtime'
import { targets, speciesTarget } from '../../target'

type RuntimeInvalidationKind = 'scene' | 'viewport' | 'chrome'

export interface SceneCanvasRuntimeOptions {
  appAdapter?: CanvasRuntimeAppAdapter
  targetPresentation?: SceneRuntimePanelTargetAdapter
}

export class SceneCanvasRuntime {
  private readonly _sceneStore = new SceneStore()
  private readonly _camera = new CameraController()
  private readonly _sceneRevision = signal(0)
  private readonly _plantNamesQueryRevision = signal(0)
  private readonly _viewportRevision = signal(0)
  private readonly _transientHistoryRevision = signal(0)
  private readonly _revision: CanvasQueryRevision = {
    scene: this._sceneRevision,
    plantNames: this._plantNamesQueryRevision,
    viewport: this._viewportRevision,
  }
  private readonly _rendererHost = new RendererHost<SceneRendererContext, SceneRendererInstance>({
    backends: [
      createPixiSceneRenderer(),
      createCanvas2DSceneRenderer(),
    ],
  })
  private readonly _rendering = new SceneRuntimeRenderScheduler({
    getRendererHost: () => this._rendererHost,
    getViewport: () => this._camera.viewport,
    prepareSceneSnapshot: async () => {
      const presentationRevision = this._currentPresentationRevision()
      const presentation = await this._presentation.refreshCurrentPresentationData()
      this._applyPresentationBackfillsIfCurrent(presentationRevision, presentation.backfills)
      return this._presentation.buildRendererSnapshot()
    },
    renderChrome: () => this._renderChrome(),
  })
  private readonly _presentation: SceneRuntimePresentationController
  private readonly _chrome = new SceneRuntimeChromeCoordinator()
  private _interaction: SceneInteractionController | null = null
  private readonly _appAdapter: CanvasRuntimeAppAdapter
  private readonly _history: SceneHistory
  private readonly _commandSurface: CanvasCommandSurface
  private readonly _sceneEdits: SceneEditCoordinator
  private readonly _mutations: SceneRuntimeMutationController
  private readonly _documents: SceneRuntimeDocumentBridge
  private readonly _documentSurface: CanvasDocumentSurface
  private readonly _querySurface: CanvasQuerySurface
  private readonly _panelTargetAdapter: SceneRuntimePanelTargetAdapter
  private readonly _disposeEffects: Array<() => void> = []

  constructor(options: SceneCanvasRuntimeOptions = {}) {
    this._appAdapter = options.appAdapter ?? createDetachedCanvasRuntimeAppAdapter()
    this._history = new SceneHistory({
      reportCleanState: (clean) => this._appAdapter.cleanState.setCanvasClean(clean),
    })
    this._panelTargetAdapter = options.targetPresentation ?? createDetachedSceneRuntimePanelTargetAdapter()
    this._presentation = new SceneRuntimePresentationController({
      sceneStore: this._sceneStore,
      getViewport: () => this._camera.viewport,
      getLocale: () => this._appAdapter.settings.readLocale(),
      resolveHighlightedTargets: (scene) => this._resolveHighlightedTargets(scene),
      onPlantNamesChanged: () => {
        this._incrementPlantNamesRevision()
      },
    })
    this._documents = new SceneRuntimeDocumentBridge({
      sceneStore: this._sceneStore,
      history: this._history,
      setSelection: (ids) => this._setSelection(ids),
      resetTransientRuntimeState: () => this._resetTransientRuntimeState(),
      clearHoveredTargets: () => this._syncHoveredCanvasTargets(null),
      clearPanelOriginTargets: () => this._panelTargetAdapter.clearPanelOriginTargets(),
      composeDocumentForSave: (input) => this._appAdapter.document.composeDocumentForSave(input),
      syncCanvasSignalsFromDocument: (file) =>
        syncCanvasSignalsFromDocument(file, this._appAdapter.settings.layerProjections),
      syncCanvasSignalsFromScene: () => this._syncCanvasSignalsFromScene(),
      invalidateScene: () => this._invalidate('scene'),
      incrementSceneRevision: () => this._incrementSceneRevision(),
      incrementViewportRevision: () => this._incrementViewportRevision(),
    })
    this._documentSurface = createSceneCanvasDocumentSurface({
      documents: this._documents,
      camera: this._camera,
      chrome: this._chrome,
      rendering: this._rendering,
      getSceneSnapshot: () => this._sceneStore.persisted,
      createPlantPresentationContext: (viewportScale) =>
        this._presentation.createPlantPresentationContext(viewportScale),
      setViewport: (viewport, options) => this._setViewport(viewport, options),
      invalidateViewport: () => this._invalidate('viewport'),
      renderChrome: () => this._renderChrome(),
      addGuide: (axis, worldPosition) => this._addGuide(axis, worldPosition),
      clearHoveredEntity: () => this._setHoveredEntityId(null, { invalidate: false }),
      disposeInteraction: () => {
        this._interaction?.dispose()
        this._interaction = null
        this._notifyTransientHistoryChanged()
      },
      disposeEffects: () => {
        for (const dispose of this._disposeEffects.splice(0)) dispose()
      },
    })
    this._sceneEdits = new SceneRuntimeEditCoordinator({
      sceneStore: this._sceneStore,
      captureSnapshot: () => this._documents.captureCommandSnapshot(),
      markDirty: (before, type) => this._documents.markDirty(before, type),
      setSelection: (ids) => this._setSelection(ids),
      invalidate: (kind) => this._invalidate(kind),
    })
    this._mutations = new SceneRuntimeMutationController({
      sceneStore: this._sceneStore,
      selection: {
        set: (ids) => this._setSelection(ids),
      },
      sceneEdits: this._sceneEdits,
      presentation: {
        syncSignals: () => syncPresentationSignalsFromSceneSession(this._sceneStore),
        syncPlantSpeciesColors: () => syncPlantSpeciesColorDefaults(this._sceneStore.persisted.plantSpeciesColors),
        getViewportScale: () => this._camera.viewport.scale,
        createPlantPresentationContext: (viewportScale) => this._presentation.createPlantPresentationContext(viewportScale),
        getSuggestedPlantColor: (canonicalName) => this._presentation.getSuggestedPlantColor(canonicalName),
      },
      invalidateScene: () => this._invalidate('scene'),
    })
    this._commandSurface = createSceneCanvasCommandSurface({
      sceneStore: this._sceneStore,
      camera: this._camera,
      history: this._history,
      transientHistory: {
        revision: this._transientHistoryRevision,
        canUndo: () => this._interaction?.canUndoTransientHistory() ?? false,
        canRedo: () => this._interaction?.canRedoTransientHistory() ?? false,
        undo: () => this._interaction?.undoTransientHistory() ?? false,
        redo: () => this._interaction?.redoTransientHistory() ?? false,
      },
      documents: this._documents,
      mutations: this._mutations,
      sceneEdits: this._sceneEdits,
      presentation: this._presentation,
      settings: this._appAdapter.settings,
      setViewport: (viewport) => this._setViewport(viewport),
      setInteractionTool: (name) => {
        this._interaction?.setTool(name)
      },
      syncCanvasSignalsFromScene: () => this._syncCanvasSignalsFromScene(),
      incrementSceneRevision: () => this._incrementSceneRevision(),
      currentPresentationRevision: () => this._currentPresentationRevision(),
      invalidate: (kind) => this._invalidate(kind),
    })
    this._querySurface = createSceneCanvasQuerySurface({
      revision: this._revision,
      sceneStore: this._sceneStore,
      camera: this._camera,
      viewportRevision: this._viewportRevision,
      mutations: this._mutations,
      presentation: this._presentation,
    })
    this._installEffects()
  }

  async init(container: HTMLElement): Promise<void> {
    refreshCanvasColorCache(container)
    await this._rendering.initialize(container)
    const viewport = this._camera.initialize({
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
    })
    this._setViewport(viewport, { forceRevision: true })
    this._interaction = new SceneInteractionController({
      container,
      getSceneStore: () => this._sceneStore,
      camera: this._camera,
      setViewport: (viewport) => this._setViewport(viewport),
      getSpeciesCache: () => this._presentation.getSpeciesCache(),
      getPlantPresentationContext: (viewportScale) => this._presentation.createPlantPresentationContext(viewportScale),
      getSelection: () => this._sceneStore.session.selectedEntityIds,
      setSelection: (ids) => this._setSelection(ids),
      clearSelection: () => this._setSelection([]),
      sceneEdits: this._sceneEdits,
      setTool: (name) => this._commandSurface.tools.setTool(name),
      render: (kind) => this._invalidate(kind),
      readSnapToGridEnabled: () => this._appAdapter.settings.readSnapToGridEnabled(),
      readSnapToGuidesEnabled: () => this._appAdapter.settings.readSnapToGuidesEnabled(),
      readPlantSpacingIntervalMeters: () => this._appAdapter.settings.readPlantSpacingIntervalMeters(),
      commitPlantSpacingIntervalMeters: (meters) => this._appAdapter.settings.commitPlantSpacingIntervalMeters(meters),
      getLocalizedCommonNames: () => this._presentation.getLocalizedCommonNames(),
      notifyTransientHistoryChange: () => this._notifyTransientHistoryChanged(),
      setHoveredEntityId: (id) => {
        this._setHoveredEntityId(id)
      },
    })
    await this._rendering.renderScene()
  }

  get commandSurface(): CanvasCommandSurface {
    return this._commandSurface
  }

  get documentSurface(): CanvasDocumentSurface {
    return this._documentSurface
  }

  get querySurface(): CanvasQuerySurface {
    return this._querySurface
  }

  destroy(): void {
    this._documentSurface.destroy()
  }

  private _setViewport(
    viewport: { x: number; y: number; scale: number },
    options: { forceRevision?: boolean } = {},
  ): void {
    const previous = this._sceneStore.session.viewport
    this._sceneStore.setViewport(viewport)
    if (
      options.forceRevision
      || previous.x !== viewport.x
      || previous.y !== viewport.y
      || previous.scale !== viewport.scale
    ) {
      this._incrementViewportRevision()
    }
  }

  private _invalidate(kind: RuntimeInvalidationKind = 'scene'): void {
    this._rendering.invalidate(kind as SceneRuntimeRenderKind)
    if (kind === 'scene' || kind === 'viewport') {
      this._interaction?.refreshMeasurements()
    }
  }

  private _currentPresentationRevision(): number {
    return this._sceneRevision.peek()
  }

  private _applyPresentationBackfillsIfCurrent(
    expectedRevision: number,
    backfills: Parameters<SceneRuntimeDocumentBridge['applyPresentationBackfills']>[0],
  ): boolean {
    if (expectedRevision !== this._currentPresentationRevision()) return false
    return this._documents.applyPresentationBackfills(backfills)
  }

  private _setSelection(ids: Iterable<string>): void {
    const nextIds = new Set(ids)
    this._sceneStore.setSelection(nextIds)
    setCanvasSelection(nextIds)
  }

  private _resetTransientRuntimeState(): void {
    resetTransientRuntimeState((name) => {
      this._interaction?.setTool(name)
    })
  }

  private _syncHoveredCanvasTargets(id: string | null): void {
    const plant = id
      ? this._sceneStore.persisted.plants.find((entry) => entry.id === id)
      : null
    const targets = plant ? [speciesTarget(plant.canonicalName)] : []
    this._panelTargetAdapter.setCanvasHoverTargets(targets)
  }

  private _setHoveredEntityId(id: string | null, options: { invalidate?: boolean } = {}): void {
    const invalidate = options.invalidate ?? true
    if (this._sceneStore.session.hoveredEntityId === id) {
      this._syncHoveredCanvasTargets(id)
      return
    }
    this._sceneStore.updateSession((s) => { s.hoveredEntityId = id })
    this._syncHoveredCanvasTargets(id)
    if (invalidate) this._invalidate('scene')
  }

  private _syncCanvasSignalsFromScene(): void {
    syncCanvasSignalsFromScene(this._sceneStore, this._appAdapter.settings.layerProjections)
  }

  private _installEffects(): void {
    this._disposeEffects.push(...installSceneRuntimeEffects({
      onTheme: () => {
        const container = this._rendering.container
        if (container) {
          refreshCanvasColorCache(container)
        }
        this._chrome.refreshTheme()
        this._invalidate('scene')
      },
      onLocale: () => {
        this._invalidate('scene')
      },
      onChromeOverlay: () => {
        this._renderChrome()
      },
      onPanelTargetHover: () => {
        this._invalidate('scene')
      },
      settings: this._appAdapter.settings,
      subscribePanelOriginTargetChanges: (onChange) =>
        this._panelTargetAdapter.subscribePanelOriginTargetChanges(onChange),
    }))
  }

  private _incrementSceneRevision(): void {
    this._sceneRevision.value += 1
  }

  private _incrementPlantNamesRevision(): void {
    this._plantNamesQueryRevision.value += 1
  }

  private _incrementViewportRevision(): void {
    this._viewportRevision.value += 1
  }

  private _notifyTransientHistoryChanged(): void {
    this._transientHistoryRevision.value += 1
  }

  private _renderChrome(): void {
    const container = this._rendering.container
    if (!container) return
    const chromeSettings = this._appAdapter.settings.readChromeOverlay()
    this._chrome.update({
      viewport: this._camera.viewport,
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      rulersVisible: chromeSettings.rulersVisible,
      gridVisible: chromeSettings.gridVisible,
      guides: this._sceneStore.persisted.guides,
    })
  }

  private _addGuide(axis: 'h' | 'v', position: number): void {
    const tx = this._sceneEdits.begin('guide-add')
    try {
      tx.mutate((draft) => {
        draft.guides.push({ id: createUuid(), axis, position })
      })
      const committed = tx.commit({ invalidate: 'chrome' })
      if (committed) {
        syncGuideSignalsFromScene(this._sceneStore)
        this._renderChrome()
      }
    } catch (error) {
      tx.abort()
      throw error
    }
  }

  private _resolveHighlightedTargets(scene: ScenePersistedState): { plantIds: readonly string[]; zoneIds: readonly string[] } {
    return targets.resolve(
      this._panelTargetAdapter.readPanelOriginTargets(),
      targets.indexScene(scene),
    )
  }
}
