import { signal } from '@preact/signals'
import { locale } from '../../app/settings/state'
import { clearPanelOriginTargets } from '../../app/panel-targets/coordinator'
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargets,
} from '../../app/panel-targets/state'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
  layerVisibility,
} from '../../app/canvas-settings/signals'
import { guides } from '../scene-metadata-state'
import { lockedObjectIds, plantNamesRevision, sceneEntityRevision } from '../runtime-mirror-state'
import type { ColorByAttribute, PlantSizeMode } from '../plant-display-state'
import type { CanopiFile, PanelTarget, PlacedPlant } from '../../types/design'
import type { SelectedPlantColorContext } from '../plant-color-context'
import { setCanvasSelection, setCanvasTool } from '../session-state'
import { syncPlantSpeciesColorDefaults } from '../plant-species-color-defaults'
import { refreshCanvasColorCache } from '../theme-refresh'
import { CameraController } from './camera'
import { SceneInteractionController } from './scene-interaction'
import { RendererHost } from './renderers'
import { createCanvas2DSceneRenderer } from './renderers/canvas2d-scene'
import { createPixiSceneRenderer } from './renderers/pixi-scene'
import type { SceneRendererContext, SceneRendererInstance } from './renderers/scene-types'
import { SceneStore } from './scene'
import {
  applySignalBackedSceneState,
  resetTransientRuntimeState,
  syncCanvasSignalsFromScene,
  syncPresentationSignalsFromSceneSession,
} from './scene-runtime/scene-sync'
import { SceneRuntimeChromeCoordinator } from './scene-runtime/chrome-coordinator'
import { SceneRuntimeDocumentBridge } from './scene-runtime/document'
import { installSceneRuntimeEffects } from './scene-runtime/effects'
import { SceneRuntimeRenderScheduler, type SceneRuntimeRenderKind } from './scene-runtime/render-scheduler'
import type { ScenePersistedState } from './scene'
import { SceneHistory } from './scene-history'
import { SceneRuntimeMutationController } from './scene-runtime/mutations'
import { SceneRuntimePresentationController } from './scene-runtime/presentation'
import type { CanvasRuntime, CanvasRuntimeDocumentMetadata } from './runtime'
import { resolvePanelTargets } from '../../panel-target-resolution'
import { panelTargetsEqual, speciesTarget } from '../../panel-targets'

type RuntimeInvalidationKind = 'scene' | 'viewport' | 'chrome'

export class SceneCanvasRuntime implements CanvasRuntime {
  private readonly _sceneStore = new SceneStore()
  private readonly _camera = new CameraController()
  private readonly _viewportRevision = signal(0)
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
      this._applySignalBackedSceneState({ recordHistory: false, syncGuides: true })
      const presentation = await this._presentation.refreshCurrentPresentationData()
      this._applyPresentationBackfillsIfCurrent(presentationRevision, presentation.backfills)
      return this._presentation.buildRendererSnapshot()
    },
    renderChrome: () => this._renderChrome(),
  })
  private readonly _presentation: SceneRuntimePresentationController
  private readonly _chrome = new SceneRuntimeChromeCoordinator()
  private _interaction: SceneInteractionController | null = null
  private readonly _history = new SceneHistory()
  private readonly _mutations: SceneRuntimeMutationController
  private readonly _documents: SceneRuntimeDocumentBridge
  private readonly _disposeEffects: Array<() => void> = []

  constructor() {
    this._presentation = new SceneRuntimePresentationController({
      sceneStore: this._sceneStore,
      getViewport: () => this._camera.viewport,
      getLocale: () => locale.value,
      resolveHighlightedTargets: (scene) => this._resolveHighlightedTargets(scene),
      onPlantNamesChanged: () => {
        plantNamesRevision.value += 1
      },
    })
    this._documents = new SceneRuntimeDocumentBridge({
      sceneStore: this._sceneStore,
      history: this._history,
      setSelection: (ids) => this._setSelection(ids),
      resetTransientRuntimeState: () => this._resetTransientRuntimeState(),
      clearHoveredTargets: () => this._syncHoveredCanvasTargets(null),
      clearPanelOriginTargets: () => this._clearPanelOriginTargets(),
      syncCanvasSignalsFromScene: () => this._syncCanvasSignalsFromScene(),
      invalidateScene: () => this._invalidate('scene'),
      incrementViewportRevision: () => {
        this._viewportRevision.value += 1
      },
      applySignalBackedSceneState: (options) => this._applySignalBackedSceneState(options),
    })
    this._mutations = new SceneRuntimeMutationController({
      sceneStore: this._sceneStore,
      selection: {
        set: (ids) => this._setSelection(ids),
      },
      locks: {
        get: () => lockedObjectIds.value,
        set: (ids) => {
          lockedObjectIds.value = new Set(ids)
        },
      },
      history: {
        captureSnapshot: () => this._documents.captureCommandSnapshot(),
        markDirty: (before, type) => this._documents.markDirty(before, type),
      },
      presentation: {
        syncSignals: () => syncPresentationSignalsFromSceneSession(this._sceneStore),
        syncPlantSpeciesColors: () => syncPlantSpeciesColorDefaults(this._sceneStore.persisted.plantSpeciesColors),
        getViewportScale: () => this._camera.viewport.scale,
        createPlantPresentationContext: (viewportScale) => this._presentation.createPlantPresentationContext(viewportScale),
        getSuggestedPlantColor: (canonicalName) => this._presentation.getSuggestedPlantColor(canonicalName),
      },
      invalidateScene: () => this._invalidate('scene'),
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
      setTool: (name) => this.setTool(name),
      render: (kind) => this._invalidate(kind),
      markDirty: (before) => this._documents.markDirty(before, 'interaction'),
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

  getViewport() {
    return this._camera.viewport
  }

  getViewportScreenSize(): { width: number; height: number } {
    return this._camera.screenSize
  }

  get viewportRevision() {
    return this._viewportRevision
  }

  getSelection(): Set<string> {
    return new Set(this._sceneStore.session.selectedEntityIds)
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
    const container = this._rendering.container
    if (!container) return
    const viewport = this._camera.initialize({
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
    })
    this._setViewport(viewport, { forceRevision: true })
    void this._rendering.renderScene()
  }

  attachRulersTo(element: HTMLElement): void {
    this._chrome.attach(element, (axis, worldPosition) => {
      this._addGuide(axis, worldPosition)
    })
    this._renderChrome()
  }

  showCanvasChrome(): void {
    this._chrome.show()
    this._renderChrome()
  }

  hideCanvasChrome(): void {
    this._chrome.hide()
    this._renderChrome()
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
    this._setViewport(this._camera.zoomToFit(this._sceneStore.persisted, {
      plantContext: this._presentation.createPlantPresentationContext(this._camera.viewport.scale),
    }))
    this._invalidate('viewport')
  }

  get canUndo() { return this._history.canUndo }
  get canRedo() { return this._history.canRedo }

  undo(): void {
    this._history.undo(this._documents.historyRuntime())
    this._syncCanvasSignalsFromScene()
    sceneEntityRevision.value += 1
    this._invalidate('scene')
  }

  redo(): void {
    this._history.redo(this._documents.historyRuntime())
    this._syncCanvasSignalsFromScene()
    sceneEntityRevision.value += 1
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
    this._mutations.selectAll(layerVisibility.value)
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
    gridVisible.value = !gridVisible.value
  }

  toggleSnapToGrid(): void {
    snapToGridEnabled.value = !snapToGridEnabled.value
  }

  toggleRulers(): void {
    rulersVisible.value = !rulersVisible.value
    this._invalidate('chrome')
  }

  getPlantSizeMode(): PlantSizeMode {
    return this._mutations.getPlantSizeMode()
  }

  setPlantSizeMode(mode: PlantSizeMode): void {
    this._mutations.setPlantSizeMode(mode)
  }

  getPlantColorByAttr(): ColorByAttribute | null {
    return this._mutations.getPlantColorByAttr()
  }

  setPlantColorByAttr(attr: ColorByAttribute | null): void {
    this._mutations.setPlantColorByAttr(attr)
  }

  getSelectedPlantColorContext(): SelectedPlantColorContext {
    return this._mutations.getSelectedPlantColorContext()
  }

  getPlacedPlants(): PlacedPlant[] {
    return this._sceneStore.toCanopiFile().plants
  }

  getLocalizedCommonNames(): ReadonlyMap<string, string | null> {
    return this._presentation.getLocalizedCommonNames()
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
    this._documents.loadDocument(file)
  }

  replaceDocument(file: CanopiFile): void {
    this._documents.replaceDocument(file)
  }

  serializeDocument(metadata: CanvasRuntimeDocumentMetadata, doc: CanopiFile): CanopiFile {
    return this._documents.serializeDocument(metadata, doc)
  }

  markSaved(): void {
    this._documents.markSaved()
  }

  clearHistory(): void {
    this._documents.clearHistory()
  }

  destroy(): void {
    this._setHoveredEntityId(null, { invalidate: false })
    this._interaction?.dispose()
    this._interaction = null
    this._chrome.destroy()
    for (const dispose of this._disposeEffects.splice(0)) dispose()
    this._rendering.dispose()
  }

  resize(width: number, height: number): void {
    this._setViewport(this._camera.resize({ width, height }), { forceRevision: true })
    this._rendering.resize(width, height)
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
      this._viewportRevision.value += 1
    }
  }

  private _invalidate(kind: RuntimeInvalidationKind = 'scene'): void {
    this._rendering.invalidate(kind as SceneRuntimeRenderKind)
  }

  private _currentPresentationRevision(): number {
    return sceneEntityRevision.value
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
    if (!panelTargetsEqual(hoveredCanvasTargets.peek(), targets)) {
      hoveredCanvasTargets.value = targets
    }
  }

  private _clearPanelOriginTargets(): void {
    clearPanelOriginTargets()
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
    syncCanvasSignalsFromScene(this._sceneStore)
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
      onLayerSignals: () => {
        const changed = this._applySignalBackedSceneState({ recordHistory: true, syncGuides: true })
        if (changed) this._invalidate('scene')
      },
      onPanelTargetHover: () => {
        this._invalidate('scene')
      },
    }))
  }

  private _renderChrome(): void {
    const container = this._rendering.container
    if (!container) return
    this._chrome.update({
      viewport: this._camera.viewport,
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      rulersVisible: rulersVisible.value,
      gridVisible: gridVisible.value,
      guides: guides.value,
    })
  }

  private _applySignalBackedSceneState(options: { recordHistory: boolean; syncGuides: boolean }): boolean {
    return applySignalBackedSceneState({
      sceneStore: this._sceneStore,
      captureSnapshot: () => this._documents.captureCommandSnapshot(),
      markDirty: (before, type) => this._documents.markDirty(before, type),
    }, options)
  }

  private _addGuide(axis: 'h' | 'v', position: number): void {
    const before = this._documents.captureCommandSnapshot()
    guides.value = [
      ...guides.value,
      { id: crypto.randomUUID(), axis, position },
    ]
    this._applySignalBackedSceneState({ recordHistory: false, syncGuides: true })
    this._documents.markDirty(before, 'guide-add')
    this._renderChrome()
  }

  private _resolveHighlightedTargets(scene: ScenePersistedState): { plantIds: readonly string[]; zoneIds: readonly string[] } {
    const combinedTargets: PanelTarget[] = [
      ...selectedPanelTargets.value,
      ...hoveredPanelTargets.value,
    ]
    return resolvePanelTargets(combinedTargets, scene)
  }
}
