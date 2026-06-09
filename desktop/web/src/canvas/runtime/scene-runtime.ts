import { signal } from '@preact/signals'
import {
  createDetachedCanvasRuntimeAppAdapter,
  type CanvasRuntimeAppAdapter,
} from './app-adapter'
import { guides } from '../scene-metadata-state'
import { plantNamesRevision, sceneEntityRevision } from '../runtime-mirror-state'
import type { ColorByAttribute, PlantSizeMode } from '../plant-display-state'
import type { CanopiFile, PlacedPlant } from '../../types/design'
import type { SelectedPlantColorContext } from '../plant-color-context'
import { setCanvasSelection, setCanvasTool } from '../session-state'
import { syncPlantSpeciesColorDefaults } from '../plant-species-color-defaults'
import { refreshCanvasColorCache } from '../theme-refresh'
import { createUuid } from '../../utils/ids'
import { CameraController } from './camera'
import { SceneInteractionController } from './scene-interaction'
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
  syncSceneLayerSignalsFromScene,
} from './scene-runtime/scene-sync'
import { SceneRuntimeChromeCoordinator } from './scene-runtime/chrome-coordinator'
import { SceneRuntimeDocumentBridge } from './scene-runtime/document'
import { createSceneCanvasDocumentSurface } from './document-surface'
import { createSceneCanvasQuerySurface } from './query-surface'
import { installSceneRuntimeEffects } from './scene-runtime/effects'
import { SceneRuntimeRenderScheduler, type SceneRuntimeRenderKind } from './scene-runtime/render-scheduler'
import type { SceneLayerEntity, ScenePersistedState } from './scene'
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
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasQueryRevision,
  CanvasRuntimeDocumentMetadata,
} from './runtime'
import { targets, speciesTarget } from '../../target'

type RuntimeInvalidationKind = 'scene' | 'viewport' | 'chrome'
type SceneLayerEdit = Partial<Pick<SceneLayerEntity, 'visible' | 'locked' | 'opacity'>>

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
      setTool: (name) => this.setTool(name),
      render: (kind) => this._invalidate(kind),
      readSnapToGridEnabled: () => this._appAdapter.settings.readSnapToGridEnabled(),
      readSnapToGuidesEnabled: () => this._appAdapter.settings.readSnapToGuidesEnabled(),
      readPlantSpacingIntervalMeters: () => this._appAdapter.settings.readPlantSpacingIntervalMeters(),
      commitPlantSpacingIntervalMeters: (meters) => this._appAdapter.settings.commitPlantSpacingIntervalMeters(meters),
      getLocalizedCommonNames: () => this._presentation.getLocalizedCommonNames(),
      setHoveredEntityId: (id) => {
        this._setHoveredEntityId(id)
      },
    })
    await this._rendering.renderScene()
  }

  getSceneStore(): SceneStore {
    return this._sceneStore
  }

  get documentSurface(): CanvasDocumentSurface {
    return this._documentSurface
  }

  get querySurface(): CanvasQuerySurface {
    return this._querySurface
  }

  getSceneSnapshot(): ScenePersistedState {
    return this._querySurface.getSceneSnapshot()
  }

  getViewport() {
    return this._querySurface.getViewport()
  }

  getViewportScreenSize(): { width: number; height: number } {
    return this._querySurface.getViewportScreenSize()
  }

  get viewportRevision() {
    return this._querySurface.viewportRevision
  }

  get revision() {
    return this._querySurface.revision
  }

  getSelection(): Set<string> {
    return this._querySurface.getSelection()
  }

  setSelection(ids: Iterable<string>): void {
    this._setSelection(ids)
    this._invalidate('scene')
  }

  clearSelection(): void {
    if (this._sceneStore.session.selectedEntityIds.size === 0) return
    this._setSelection([])
    this._invalidate('scene')
  }

  initializeViewport(): void {
    this._documentSurface.initializeViewport()
  }

  attachRulersTo(element: HTMLElement): void {
    this._documentSurface.attachRulersTo(element)
  }

  showCanvasChrome(): void {
    this._documentSurface.showCanvasChrome()
  }

  hideCanvasChrome(): void {
    this._documentSurface.hideCanvasChrome()
  }

  setTool(name: string): void {
    setCanvasTool(name)
    this._interaction?.setTool(name)
  }

  zoomIn(): void {
    this._setViewport(this._camera.zoomIn())
    this._invalidate('viewport')
  }

  zoomOut(): void {
    this._setViewport(this._camera.zoomOut())
    this._invalidate('viewport')
  }

  zoomToFit(): void {
    this._documentSurface.zoomToFit()
  }

  get canUndo() { return this._history.canUndo }
  get canRedo() { return this._history.canRedo }

  undo(): void {
    this._history.undo(this._documents.historyRuntime())
    this._syncCanvasSignalsFromScene()
    this._incrementSceneRevision()
    this._invalidate('scene')
  }

  redo(): void {
    this._history.redo(this._documents.historyRuntime())
    this._syncCanvasSignalsFromScene()
    this._incrementSceneRevision()
    this._invalidate('scene')
  }

  copy(): void {
    this._mutations.copy()
  }

  paste(): void {
    this._mutations.paste()
  }

  duplicateSelected(): void {
    this._mutations.duplicateSelected()
  }

  deleteSelected(): void {
    this._mutations.deleteSelected()
  }

  selectAll(): void {
    this._mutations.selectAll()
  }

  bringToFront(): void {
    this._mutations.bringToFront()
  }

  sendToBack(): void {
    this._mutations.sendToBack()
  }

  lockSelected(): void {
    this._mutations.lockSelected()
  }

  unlockSelected(): void {
    this._mutations.unlockSelected()
  }

  groupSelected(): void {
    this._mutations.groupSelected()
  }

  ungroupSelected(): void {
    this._mutations.ungroupSelected()
  }

  toggleGrid(): void {
    this._appAdapter.settings.toggleGridVisible()
  }

  toggleSnapToGrid(): void {
    this._appAdapter.settings.toggleSnapToGrid()
  }

  toggleRulers(): void {
    this._appAdapter.settings.toggleRulersVisible()
    this._invalidate('chrome')
  }

  setSceneLayerVisibility(name: string, visible: boolean): boolean {
    return this._setSceneLayerState(name, { visible })
  }

  setSceneLayerOpacity(name: string, opacity: number): boolean {
    if (!Number.isFinite(opacity)) return false
    return this._setSceneLayerState(name, {
      opacity: Math.min(1, Math.max(0, opacity)),
    })
  }

  setSceneLayerLocked(name: string, locked: boolean): boolean {
    return this._setSceneLayerState(name, { locked })
  }

  getPlantSizeMode(): PlantSizeMode {
    return this._querySurface.getPlantSizeMode()
  }

  setPlantSizeMode(mode: PlantSizeMode): void {
    this._mutations.setPlantSizeMode(mode)
  }

  getPlantColorByAttr(): ColorByAttribute | null {
    return this._querySurface.getPlantColorByAttr()
  }

  setPlantColorByAttr(attr: ColorByAttribute | null): void {
    this._mutations.setPlantColorByAttr(attr)
  }

  getSelectedPlantColorContext(): SelectedPlantColorContext {
    return this._querySurface.getSelectedPlantColorContext()
  }

  getPlacedPlants(): PlacedPlant[] {
    return this._querySurface.getPlacedPlants()
  }

  getLocalizedCommonNames(): ReadonlyMap<string, string | null> {
    return this._querySurface.getLocalizedCommonNames()
  }

  async ensureSpeciesCacheEntries(canonicalNames: string[], activeLocale: string): Promise<boolean> {
    const presentationRevision = this._currentPresentationRevision()
    const result = await this._presentation.refreshSpeciesCacheEntries(canonicalNames, activeLocale)
    const appliedBackfills = this._applyPresentationBackfillsIfCurrent(
      presentationRevision,
      result.backfills,
    )
    if (presentationRevision !== this._currentPresentationRevision()) return false
    if (result.changed) this._invalidate('scene')
    return result.changed || appliedBackfills
  }

  setSelectedPlantColor(color: string | null): number {
    return this._mutations.setSelectedPlantColor(color)
  }

  setPlantColorForSpecies(canonicalName: string, color: string | null): number {
    return this._mutations.setPlantColorForSpecies(canonicalName, color)
  }

  clearPlantSpeciesColor(canonicalName: string): boolean {
    return this._mutations.clearPlantSpeciesColor(canonicalName)
  }

  loadDocument(file: CanopiFile): void {
    this._documentSurface.loadDocument(file)
  }

  replaceDocument(file: CanopiFile): void {
    this._documentSurface.replaceDocument(file)
  }

  hasLoadedDocument(): boolean {
    return this._documentSurface.hasLoadedDocument()
  }

  serializeDocument(metadata: CanvasRuntimeDocumentMetadata, doc: CanopiFile): CanopiFile {
    return this._documentSurface.serializeDocument(metadata, doc)
  }

  markSaved(): void {
    this._documentSurface.markSaved()
  }

  clearHistory(): void {
    this._documentSurface.clearHistory()
  }

  destroy(): void {
    this._documentSurface.destroy()
  }

  resize(width: number, height: number): void {
    this._documentSurface.resize(width, height)
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
    sceneEntityRevision.value += 1
    this._sceneRevision.value += 1
  }

  private _incrementPlantNamesRevision(): void {
    plantNamesRevision.value += 1
    this._plantNamesQueryRevision.value += 1
  }

  private _incrementViewportRevision(): void {
    this._viewportRevision.value += 1
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
      guides: guides.value,
    })
  }

  private _setSceneLayerState(name: string, edit: SceneLayerEdit): boolean {
    if (this._appAdapter.settings.layerProjections.isAppOwnedLayerProjection(name)) return false

    const committed = this._sceneEdits.run('scene-layer-settings', (tx) => {
      tx.mutate((draft) => {
        const layer = draft.layers.find((entry) => entry.name === name)
        if (!layer) return
        if (edit.visible !== undefined) layer.visible = edit.visible
        if (edit.locked !== undefined) layer.locked = edit.locked
        if (edit.opacity !== undefined) layer.opacity = edit.opacity
      })
    })
    if (committed) {
      syncSceneLayerSignalsFromScene(
        this._sceneStore,
        name,
        this._appAdapter.settings.layerProjections,
      )
    }
    return committed
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
