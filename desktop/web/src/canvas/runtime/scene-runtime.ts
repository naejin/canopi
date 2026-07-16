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
import {
  normalizeSceneDesignObjectTargets,
  sceneDesignObjectTargetsEqual,
  sceneTargetKey,
  type SceneDesignObjectTarget,
  type ScenePersistedState,
} from './scene'
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
      setSelection: (targets) => this._setSelection(targets),
      prepareForDocumentReplacement: () => this._prepareForDocumentReplacement(),
      syncHoveredCanvasTargets: (target) => this._syncHoveredCanvasTargets(target),
      syncCanvasSignalsFromScene: () => this._syncCanvasSignalsFromScene(),
      invalidate: (kind) => this._invalidate(kind),
      incrementSceneRevision: () => this._incrementSceneRevision(),
      renderChrome: () => this._renderChrome(),
      addGuide: (axis, worldPosition) => this._addGuide(axis, worldPosition),
      setHoveredTarget: (target, options) => this._setHoveredTarget(target, options),
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
      this._camera.initialize({
        width: Math.max(1, container.clientWidth),
        height: Math.max(1, container.clientHeight),
      })
      this._interaction = createSceneInteractionSession({
        container,
        getSceneStore: () => this._sceneState,
        camera: this._camera,
        getSpeciesCache: () => this._presentation.getSpeciesCache(),
        getPlantPresentationContext: (viewportScale) =>
          this._presentation.createPlantPresentationContext(viewportScale),
        getSelection: () => this._sceneState.session.selectedTargets,
        setSelection: (targets) => {
          this._sceneCommands.runWhenSettled(
            () => this._setSelection(targets),
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
        contextualCommands: this._appAdapter.savedObjectStamps
          ? {
              saveSelectionAsObjectStamp: () =>
                this._commandSurface.sceneEdits.saveSelectionAsObjectStamp(),
            }
          : undefined,
        setTool: (name) => this._commandSurface.tools.setTool(name),
        render: (kind) => this._invalidate(kind),
        readSnapToGridEnabled: () => this._appAdapter.settings.readSnapToGridEnabled(),
        readSnapToGuidesEnabled: () => this._appAdapter.settings.readSnapToGuidesEnabled(),
        readPlantSpacingIntervalMeters: () => this._appAdapter.settings.readPlantSpacingIntervalMeters(),
        commitPlantSpacingIntervalMeters: (meters) =>
          this._appAdapter.settings.commitPlantSpacingIntervalMeters(meters),
        translate: this._appAdapter.translate,
        getLocalizedCommonNames: () => this._presentation.getLocalizedCommonNames(),
        notifyTransientHistoryChange: () => this._notifyTransientHistoryChanged(),
        setHoveredTarget: (target) => {
          this._setHoveredTarget(target)
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

  private _invalidate(kind: RuntimeInvalidationKind = 'scene'): void {
    this._rendering.invalidate(kind as SceneRuntimeRenderKind)
    if (kind === 'scene' || kind === 'viewport') {
      this._interaction?.refreshMeasurements()
    }
  }

  private _setSelection(targets: Iterable<SceneDesignObjectTarget>): void {
    const nextTargets = normalizeSceneDesignObjectTargets(targets)
    const typedIdentityChanged = !sceneDesignObjectTargetsEqual(
      this._sceneState.session.selectedTargets,
      nextTargets,
    )
    this._sceneSession.setSelection(nextTargets)
    setCanvasSelection(
      nextTargets.map((target) => target.id),
      { publishIfUnchanged: typedIdentityChanged },
    )
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

  private _syncHoveredCanvasTargets(target: SceneDesignObjectTarget | null): void {
    const plant = target?.kind === 'plant'
      ? this._sceneState.persisted.plants.find((entry) => entry.id === target.id)
      : null
    const targets = plant ? [speciesTarget(plant.canonicalName)] : []
    this._panelTargetAdapter.setCanvasHoverTargets(targets)
  }

  private _setHoveredTarget(
    target: SceneDesignObjectTarget | null,
    options: { invalidate?: boolean } = {},
  ): void {
    const invalidate = options.invalidate ?? true
    const current = this._sceneState.session.hoveredTarget
    if (current === null ? target === null : target !== null && sceneTargetKey(current) === sceneTargetKey(target)) {
      this._syncHoveredCanvasTargets(target)
      return
    }
    this._sceneSession.setHoveredTarget(target)
    this._syncHoveredCanvasTargets(target)
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
        this._interaction?.refreshTranslations()
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

  private _notifyTransientHistoryChanged(): void {
    this._transientHistoryRevision.value += 1
  }

  private _renderChrome(): void {
    const container = this._rendering.container
    if (!container) return
    const chromeSettings = this._appAdapter.settings.readChromeOverlay()
    this._chrome.update({
      camera: this._camera.snapshot.peek(),
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
