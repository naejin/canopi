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
  guides,
  lockedObjectIds,
  plantNamesRevision,
  rulersVisible,
  sceneEntityRevision,
  snapToGridEnabled,
} from '../../state/canvas'
import { layerVisibility } from '../../app/canvas-settings/signals'
import type { ColorByAttribute, PlantSizeMode } from '../plant-display-state'
import type { CanopiFile, PanelTarget, PlacedPlant } from '../../types/design'
import type { SelectedPlantColorContext } from '../plant-color-context'
import { clearCanvasSelection, setCanvasSelection, setCanvasTool } from '../session-state'
import { syncPlantSpeciesColorDefaults } from '../plant-species-color-defaults'
import { refreshCanvasColorCache } from '../theme-refresh'
import { CameraController } from './camera'
import { SceneChromeOverlay } from './scene-chrome'
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
import { installSceneRuntimeEffects } from './scene-runtime/effects'
import type { ScenePersistedState } from './scene'
import { createScenePatchCommand, type SceneCommandSnapshot } from './scene-commands'
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
  private readonly _presentation: SceneRuntimePresentationController
  private _container: HTMLElement | null = null
  private _chrome: SceneChromeOverlay | null = null
  private _interaction: SceneInteractionController | null = null
  private _chromeVisible = false
  private readonly _history = new SceneHistory()
  private readonly _mutations: SceneRuntimeMutationController
  private readonly _disposeEffects: Array<() => void> = []
  private _renderEpoch = 0

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
        captureSnapshot: () => this._captureCommandSnapshot(),
        markDirty: (before, type) => this._markCanvasDirty(before, type),
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
    this._container = container
    refreshCanvasColorCache(container)
    await this._rendererHost.initialize({ container })
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
      markDirty: (before) => this._markCanvasDirty(before, 'interaction'),
      getLocalizedCommonNames: () => this._presentation.getLocalizedCommonNames(),
      setHoveredEntityId: (id) => {
        this._setHoveredEntityId(id)
      },
    })
    await this._render()
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
    if (!this._container) return
    const viewport = this._camera.initialize({
      width: Math.max(1, this._container.clientWidth),
      height: Math.max(1, this._container.clientHeight),
    })
    this._setViewport(viewport, { forceRevision: true })
    void this._render()
  }

  attachRulersTo(element: HTMLElement): void {
    this._chrome?.destroy()
    this._chrome = new SceneChromeOverlay(element)
    this._chrome.setGuideCreate((axis, worldPosition) => {
      this._addGuide(axis, worldPosition)
    })
    this._renderChrome()
  }

  showCanvasChrome(): void {
    this._chromeVisible = true
    this._renderChrome()
  }

  hideCanvasChrome(): void {
    this._chromeVisible = false
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
    this._history.undo(this._historyRuntime())
    this._syncCanvasSignalsFromScene()
    sceneEntityRevision.value += 1
    this._invalidate('scene')
  }

  redo(): void {
    this._history.redo(this._historyRuntime())
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
    const result = await this._presentation.refreshSpeciesCacheEntries(canonicalNames, activeLocale)
    this._applyPresentationBackfills(result.backfills)
    if (result.changed) this._invalidate('scene')
    return result.changed
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
    this._syncHoveredCanvasTargets(null)
    this._clearPanelOriginTargets()
    this._sceneStore.hydrate(file)
    this._viewportRevision.value += 1
    this._history.clear()
    lockedObjectIds.value = new Set()
    clearCanvasSelection()
    this._syncCanvasSignalsFromScene()
    this._invalidate('scene')
    sceneEntityRevision.value += 1
  }

  replaceDocument(file: CanopiFile): void {
    this._resetTransientRuntimeState()
    this._syncHoveredCanvasTargets(null)
    this._clearPanelOriginTargets()
    this._sceneStore.hydrate(file)
    this._viewportRevision.value += 1
    this._history.clear()
    this._syncCanvasSignalsFromScene()
    this._invalidate('scene')
    sceneEntityRevision.value += 1
  }

  serializeDocument(metadata: CanvasRuntimeDocumentMetadata, doc: CanopiFile): CanopiFile {
    // Check before updatePersisted — if neither signal nor persisted has guides,
    // skip guide sync so doc-provided guides in extra are preserved.
    const shouldSyncGuides = guides.value.length > 0 || Array.isArray(this._sceneStore.persisted.extra?.guides)
    this._sceneStore.updatePersisted((persisted) => {
      persisted.name = metadata.name
      persisted.description = metadata.description ?? doc.description ?? null
      persisted.location = metadata.location
        ? {
            lat: metadata.location.lat,
            lon: metadata.location.lon,
            altitudeM: metadata.location.altitude_m ?? null,
          }
        : hydrateLocationFromDoc(doc.location ?? null, persisted.location)
      persisted.northBearingDeg = metadata.northBearingDeg ?? doc.north_bearing_deg ?? persisted.northBearingDeg
      persisted.createdAt = doc.created_at ?? persisted.createdAt
      persisted.extra = { ...(doc.extra ?? persisted.extra ?? {}) }
    })
    this._applySignalBackedSceneState({ recordHistory: false, syncGuides: shouldSyncGuides })

    // Canvas-only output from scene store
    const canvasOutput = this._sceneStore.toCanopiFile({ now: new Date() })

    // Compose final document: canvas state + non-canvas sections from document store
    return {
      ...canvasOutput,
      description: metadata.description ?? doc.description ?? canvasOutput.description,
      consortiums: doc.consortiums,
      timeline: doc.timeline,
      budget: doc.budget,
      budget_currency: doc.budget_currency ?? 'EUR',
    }
  }

  markSaved(): void {
    this._history.markSaved()
  }

  clearHistory(): void {
    this._history.clear()
  }

  destroy(): void {
    this._setHoveredEntityId(null, { invalidate: false })
    this._interaction?.dispose()
    this._interaction = null
    this._chrome?.destroy()
    this._chrome = null
    for (const dispose of this._disposeEffects.splice(0)) dispose()
    void this._rendererHost.dispose()
  }

  resize(width: number, height: number): void {
    this._setViewport(this._camera.resize({ width, height }), { forceRevision: true })
    void this._rendererHost.run((renderer) => {
      renderer.resize(width, height)
      renderer.setViewport(this._camera.viewport)
    })
    this._invalidate('chrome')
  }

  private _markCanvasDirty(before: SceneCommandSnapshot, type = 'scene-mutation'): void {
    const after = this._captureCommandSnapshot()
    const command = createScenePatchCommand(type, before, after)
    if (!command) return
    this._history.record(command)
    this._sceneStore.updateSession((session) => {
      session.documentRevision += 1
    })
    sceneEntityRevision.value += 1
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
    if (kind === 'chrome') {
      this._renderChrome()
      return
    }
    if (!this._container) return
    if (kind === 'viewport') {
      void this._renderViewportOnly()
      return
    }
    void this._render()
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

  private _captureCommandSnapshot(): SceneCommandSnapshot {
    const snapshot = this._sceneStore.snapshot()
    return {
      persisted: snapshot.persisted,
      session: snapshot.session,
      lockedIds: new Set(lockedObjectIds.value),
    }
  }

  private _historyRuntime() {
    return {
      sceneStore: this._sceneStore,
      setSelection: (ids: Iterable<string>) => {
        this._setSelection(ids)
      },
      setLockedIds: (ids: Iterable<string>) => {
        lockedObjectIds.value = new Set(ids)
      },
    }
  }

  private _installEffects(): void {
    this._disposeEffects.push(...installSceneRuntimeEffects({
      onTheme: () => {
        if (this._container) {
          refreshCanvasColorCache(this._container)
        }
        this._chrome?.refreshTheme()
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

  private async _render(): Promise<void> {
    if (!this._container) return
    const renderEpoch = ++this._renderEpoch
    this._applySignalBackedSceneState({ recordHistory: false, syncGuides: true })
    const presentation = await this._presentation.refreshCurrentPresentationData()
    this._applyPresentationBackfills(presentation.backfills)
    if (renderEpoch !== this._renderEpoch) return
    const snapshot = this._presentation.buildRendererSnapshot()
    await this._rendererHost.run((renderer) => {
      renderer.resize(
        Math.max(1, this._container?.clientWidth ?? 1),
        Math.max(1, this._container?.clientHeight ?? 1),
      )
      renderer.renderScene(snapshot)
    }, {
      operationName: 'render scene',
    })
    this._renderChrome()
  }

  private async _renderViewportOnly(): Promise<void> {
    if (!this._container) return
    await this._rendererHost.run((renderer) => {
      renderer.setViewport(this._camera.viewport)
    }, {
      operationName: 'update viewport',
    })
    this._renderChrome()
  }

  private _renderChrome(): void {
    if (!this._chrome || !this._container) return
    this._chrome.update({
      viewport: this._camera.viewport,
      width: Math.max(1, this._container.clientWidth),
      height: Math.max(1, this._container.clientHeight),
      chromeVisible: this._chromeVisible,
      rulersVisible: rulersVisible.value,
      gridVisible: gridVisible.value,
      guides: guides.value,
    })
  }

  private _applySignalBackedSceneState(options: { recordHistory: boolean; syncGuides: boolean }): boolean {
    return applySignalBackedSceneState({
      sceneStore: this._sceneStore,
      captureSnapshot: () => this._captureCommandSnapshot(),
      markDirty: (before, type) => this._markCanvasDirty(before, type),
    }, options)
  }

  private _addGuide(axis: 'h' | 'v', position: number): void {
    const before = this._captureCommandSnapshot()
    guides.value = [
      ...guides.value,
      { id: crypto.randomUUID(), axis, position },
    ]
    this._applySignalBackedSceneState({ recordHistory: false, syncGuides: true })
    this._markCanvasDirty(before, 'guide-add')
    this._renderChrome()
  }

  private _applyPresentationBackfills(
    backfills: ReadonlyArray<{ plantId: string; stratum: string | null; canopySpreadM: number | null; scale: number | null }> | null,
  ): void {
    if (!backfills || backfills.length === 0) return
    const byId = new Map(backfills.map((entry) => [entry.plantId, entry]))
    this._sceneStore.updatePersisted((draft) => {
      draft.plants = draft.plants.map((plant) => {
        const next = byId.get(plant.id)
        if (!next) return plant
        return {
          ...plant,
          stratum: next.stratum,
          canopySpreadM: next.canopySpreadM,
          scale: next.scale,
        }
      })
    })
  }

  private _resolveHighlightedTargets(scene: ScenePersistedState): { plantIds: readonly string[]; zoneIds: readonly string[] } {
    const combinedTargets: PanelTarget[] = [
      ...selectedPanelTargets.value,
      ...hoveredPanelTargets.value,
    ]
    return resolvePanelTargets(combinedTargets, scene)
  }
}

function hydrateLocationFromDoc(
  location: CanopiFile['location'] | null,
  fallback: ScenePersistedState['location'],
) {
  if (!location) return fallback ?? null
  return {
    lat: location.lat,
    lon: location.lon,
    altitudeM: location.altitude_m ?? null,
  }
}
