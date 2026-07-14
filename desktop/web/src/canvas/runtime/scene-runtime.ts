import { setCanvasSelection } from '../session-state'
import { refreshCanvasColorCache } from '../theme-refresh'
import { createUuid } from '../../utils/ids'
import {
  createSceneInteractionSession,
  type SceneInteractionSession,
} from './scene-interaction'
import {
  resetTransientRuntimeState,
  syncCanvasSignalsFromScene,
} from './scene-runtime/scene-sync'
import { installSceneRuntimeEffects } from './scene-runtime/effects'
import type { SceneRuntimeRenderKind } from './scene-runtime/render-scheduler'
import type { ScenePersistedState } from './scene'
import {
  createSceneRuntimeConstruction,
  type SceneRuntimeConstruction,
  type SceneRuntimeConstructionOptions,
} from './scene-runtime/construction'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
} from './runtime'
import { targets, speciesTarget } from '../../target'
import { runCanvasRuntimeCleanups, throwCanvasRuntimeCleanupErrors } from './cleanup'

type RuntimeInvalidationKind = 'scene' | 'viewport' | 'chrome'

export type SceneCanvasRuntimeOptions = SceneRuntimeConstructionOptions

export class SceneCanvasRuntime {
  private readonly _construction: SceneRuntimeConstruction
  private _interaction: SceneInteractionSession | null = null

  constructor(options: SceneCanvasRuntimeOptions = {}) {
    this._construction = createSceneRuntimeConstruction(options, {
      resolveHighlightedTargets: (scene) => this._resolveHighlightedTargets(scene),
      incrementPlantNamesRevision: () => this._incrementPlantNamesRevision(),
      setSelection: (ids) => this._setSelection(ids),
      prepareForDocumentReplacement: () => this._prepareForDocumentReplacement(),
      syncHoveredCanvasTargets: (id) => this._syncHoveredCanvasTargets(id),
      syncCanvasSignalsFromScene: () => this._syncCanvasSignalsFromScene(),
      invalidate: (kind) => this._invalidate(kind),
      incrementSceneRevision: () => this._incrementSceneRevision(),
      incrementViewportRevision: () => this._incrementViewportRevision(),
      setViewport: (viewport, options) => this._setViewport(viewport, options),
      renderChrome: () => this._renderChrome(),
      addGuide: (axis, worldPosition) => this._addGuide(axis, worldPosition),
      setHoveredEntityId: (id, options) => this._setHoveredEntityId(id, options),
      disposeInteraction: () => {
        const interaction = this._interaction
        this._interaction = null
        try {
          interaction?.dispose()
        } finally {
          this._notifyTransientHistoryChanged()
        }
      },
      notifyTransientHistoryChanged: () => this._notifyTransientHistoryChanged(),
      canUndoTransientHistory: () => this._interaction?.canUndoTransientHistory() ?? false,
      canRedoTransientHistory: () => this._interaction?.canRedoTransientHistory() ?? false,
      undoTransientHistory: () => this._interaction?.undoTransientHistory() ?? false,
      redoTransientHistory: () => this._interaction?.redoTransientHistory() ?? false,
      setInteractionTool: (name) => {
        this._interaction?.setTool(name)
      },
    })
    this._installEffects()
  }

  private get _sceneState(): SceneRuntimeConstruction['sceneState'] {
    return this._construction.sceneState
  }

  private get _sceneSession(): SceneRuntimeConstruction['sceneSession'] {
    return this._construction.sceneSession
  }

  private get _camera(): SceneRuntimeConstruction['camera'] {
    return this._construction.camera
  }

  private get _sceneRevision(): SceneRuntimeConstruction['sceneRevision'] {
    return this._construction.sceneRevision
  }

  private get _plantNamesQueryRevision(): SceneRuntimeConstruction['plantNamesQueryRevision'] {
    return this._construction.plantNamesQueryRevision
  }

  private get _viewportRevision(): SceneRuntimeConstruction['viewportRevision'] {
    return this._construction.viewportRevision
  }

  private get _transientHistoryRevision(): SceneRuntimeConstruction['transientHistoryRevision'] {
    return this._construction.transientHistoryRevision
  }

  private get _rendering(): SceneRuntimeConstruction['rendering'] {
    return this._construction.rendering
  }

  private get _presentation(): SceneRuntimeConstruction['presentation'] {
    return this._construction.presentation
  }

  private get _chrome(): SceneRuntimeConstruction['chrome'] {
    return this._construction.chrome
  }

  private get _appAdapter(): SceneRuntimeConstruction['appAdapter'] {
    return this._construction.appAdapter
  }

  private get _commandSurface(): CanvasCommandSurface {
    return this._construction.commandSurface
  }

  private get _sceneCommands(): SceneRuntimeConstruction['sceneCommands'] {
    return this._construction.sceneCommands
  }

  private get _settledReader(): SceneRuntimeConstruction['settledReader'] {
    return this._construction.settledReader
  }

  private get _documentSurface(): CanvasDocumentSurface {
    return this._construction.documentSurface
  }

  private get _querySurface(): CanvasQuerySurface {
    return this._construction.querySurface
  }

  private get _panelTargetAdapter(): SceneRuntimeConstruction['panelTargetAdapter'] {
    return this._construction.panelTargetAdapter
  }

  private get _disposeEffects(): SceneRuntimeConstruction['disposeEffects'] {
    return this._construction.disposeEffects
  }

  async init(container: HTMLElement): Promise<void> {
    try {
      refreshCanvasColorCache(container)
      await this._rendering.initialize(container)
      const viewport = this._camera.initialize({
        width: Math.max(1, container.clientWidth),
        height: Math.max(1, container.clientHeight),
      })
      this._setViewport(viewport, { forceRevision: true })
      this._interaction = createSceneInteractionSession({
        container,
        getSceneStore: () => this._sceneState,
        camera: this._camera,
        setViewport: (viewport) => this._setViewport(viewport),
        getSpeciesCache: () => this._presentation.getSpeciesCache(),
        getPlantPresentationContext: (viewportScale) =>
          this._presentation.createPlantPresentationContext(viewportScale),
        getSelection: () => this._sceneState.session.selectedEntityIds,
        setSelection: (ids) => {
          this._sceneCommands.runWhenSettled(
            () => this._setSelection(ids),
            undefined,
            { resumePending: true },
          )
        },
        clearSelection: () => {
          this._sceneCommands.runWhenSettled(
            () => this._setSelection([]),
            undefined,
            { resumePending: true },
          )
        },
        sceneEdits: this._sceneCommands,
        commandAdmission: this._sceneCommands,
        settledReader: this._settledReader,
        getDesignObjectSelection: () => this._querySurface.getDesignObjectSelection(),
        selectionCommands: this._commandSurface.sceneEdits,
        contextualCommands: {
          saveSelectionAsObjectStamp: () =>
            this._commandSurface.sceneEdits.saveSelectionAsObjectStamp(),
        },
        setTool: (name) => this._commandSurface.tools.setTool(name),
        render: (kind) => this._invalidate(kind),
        readSnapToGridEnabled: () => this._appAdapter.settings.readSnapToGridEnabled(),
        readSnapToGuidesEnabled: () => this._appAdapter.settings.readSnapToGuidesEnabled(),
        readPlantSpacingIntervalMeters: () => this._appAdapter.settings.readPlantSpacingIntervalMeters(),
        commitPlantSpacingIntervalMeters: (meters) =>
          this._appAdapter.settings.commitPlantSpacingIntervalMeters(meters),
        getLocalizedCommonNames: () => this._presentation.getLocalizedCommonNames(),
        notifyTransientHistoryChange: () => this._notifyTransientHistoryChanged(),
        setHoveredEntityId: (id) => {
          this._setHoveredEntityId(id)
        },
      })
      await this._rendering.renderScene()
    } catch (error) {
      const errors: unknown[] = [error]
      try {
        this._documentSurface.destroy()
      } catch (cleanupError) {
        errors.push(cleanupError)
      }
      throwCanvasRuntimeCleanupErrors(errors, 'Scene Canvas runtime initialization failed')
    }
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
    const previous = this._sceneState.session.viewport
    this._sceneSession.setViewport(viewport)
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

  private _setSelection(ids: Iterable<string>): void {
    const nextIds = new Set(ids)
    this._sceneSession.setSelection(nextIds)
    setCanvasSelection(nextIds)
  }

  private _resetTransientRuntimeState(): void {
    resetTransientRuntimeState((name) => {
      this._commandSurface.tools.setTool(name)
    })
  }

  private _prepareForDocumentReplacement(): void {
    runCanvasRuntimeCleanups([
      () => this._interaction?.prepareForDocumentReplacement(),
      () => this._resetTransientRuntimeState(),
    ], 'Scene Canvas document replacement preparation failed')
  }

  private _syncHoveredCanvasTargets(id: string | null): void {
    const plant = id
      ? this._sceneState.persisted.plants.find((entry) => entry.id === id)
      : null
    const targets = plant ? [speciesTarget(plant.canonicalName)] : []
    this._panelTargetAdapter.setCanvasHoverTargets(targets)
  }

  private _setHoveredEntityId(id: string | null, options: { invalidate?: boolean } = {}): void {
    const invalidate = options.invalidate ?? true
    if (this._sceneState.session.hoveredEntityId === id) {
      this._syncHoveredCanvasTargets(id)
      return
    }
    this._sceneSession.setHoveredEntityId(id)
    this._syncHoveredCanvasTargets(id)
    if (invalidate) this._invalidate('scene')
  }

  private _syncCanvasSignalsFromScene(): void {
    syncCanvasSignalsFromScene(this._sceneState, this._appAdapter.settings.layerProjections)
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
      guides: this._sceneState.persisted.guides,
    })
  }

  private _addGuide(axis: 'h' | 'v', position: number): void {
    this._sceneCommands.run('guide-add', (tx) => {
      tx.mutate((draft) => {
        draft.guides.push({ id: createUuid(), axis, position })
      })
    }, {
      invalidate: 'chrome',
      onCommitted: () => this._renderChrome(),
    })
  }

  private _resolveHighlightedTargets(scene: ScenePersistedState): { plantIds: readonly string[]; zoneIds: readonly string[] } {
    return targets.resolve(
      this._panelTargetAdapter.readPanelOriginTargets(),
      targets.indexScene(scene),
    )
  }
}
