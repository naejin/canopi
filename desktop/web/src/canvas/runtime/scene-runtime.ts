import { batch, effect, type ReadonlySignal } from '@preact/signals'
import { setCanvasSelection, setCanvasToolGuidance } from '../session-state'
import { refreshCanvasColorCache } from '../theme-refresh'
import { setCanvasMapBackdrop } from './scene-visuals'
import { DEFAULT_PLANT_DISPLAY, setCanvasPlantDisplay } from './plant-display'
import { createUuid } from '../../utils/ids'
import {
  createSceneInteractionSession,
  type SceneInteractionSession,
} from './interaction-session'
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
  CanvasKeyboardPort,
  CanvasQuerySurface,
} from './runtime'
import { bindQuerySurfacePointerWorld } from './query-surface'
import { targets, speciesTarget } from '../../target'
import { runCanvasRuntimeCleanups, throwCanvasRuntimeCleanupErrors } from './cleanup'
import type { CameraDriverHost } from './view/camera-driver'

type RuntimeInvalidationKind = 'scene' | 'viewport' | 'chrome'

export type SceneCanvasRuntimeOptions = SceneRuntimeConstructionOptions

export class SceneCanvasRuntime {
  private readonly _construction: SceneRuntimeConstruction
  private _interaction: SceneInteractionSession | null = null
  private _cameraMode: 'site' | 'overview'

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
        bindQuerySurfacePointerWorld(this._querySurface, null)
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
      readInteractionTool: () => this._interaction?.tool ?? null,
      plantRowSpacing: {
        input: (text) => this._interaction?.plantRowSpacing.input(text),
        commit: (text) => this._interaction?.plantRowSpacing.commit(text),
        blur: (text) => this._interaction?.plantRowSpacing.blur(text),
        cancel: () => this._interaction?.plantRowSpacing.cancel(),
      },
    })
    this._cameraMode = this._construction.frames.viewFrame.peek().mode
    this._installEffects()
  }

  private get _sceneState(): SceneRuntimeConstruction['sceneState'] {
    return this._construction.sceneState
  }

  private get _sceneSession(): SceneRuntimeConstruction['sceneSession'] {
    return this._construction.sceneSession
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
      this._disposeEffects.push(markBusyWhileScenePending(container, this._rendering.scenePending))
      await this._rendering.initialize(container)
      // The first frame is the fit (plan §1, exception 3): the Design's for one loaded before init, else the new-Design overview.
      // One batch, so the screen size and the fit reach the runtime's effects as one frame. An attached map keeps its own screen.
      batch(() => {
        if (!this._construction.frames.viewFrame.peek().attached) {
          this.cameraHost.current().setScreen({
            width: Math.max(1, container.clientWidth),
            height: Math.max(1, container.clientHeight),
            devicePixelRatio: window.devicePixelRatio,
          })
        }
        this._documentSurface.zoomToFit()
      })
      this._interaction = createSceneInteractionSession({
        container,
        getSceneStore: () => this._sceneState,
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
        tryInspectAt: this._appAdapter.tryInspectAt,
        getDesignObjectSelection: () => this._querySurface.getDesignObjectSelection(),
        selectionCommands: this._commandSurface.sceneEdits,
        contextualCommands: this._appAdapter.savedObjectStamps
          ? {
              saveSelectionAsObjectStamp: () =>
                this._commandSurface.sceneEdits.saveSelectionAsObjectStamp(),
            }
          : undefined,
        contextMenu: this._appAdapter.contextMenu,
        setTool: (name) => this._commandSurface.tools.setTool(name),
        render: (kind) => this._invalidate(kind),
        readSnapToGridEnabled: () => this._appAdapter.settings.readSnapToGridEnabled(),
        readSnapToGuidesEnabled: () => this._appAdapter.settings.readSnapToGuidesEnabled(),
        readSingleKeyShortcuts: () => this._appAdapter.settings.readSingleKeyShortcuts(),
        readScrollWheel: () => this._appAdapter.settings.readScrollWheel(),
        readPlantSpacingIntervalMeters: () => this._appAdapter.settings.readPlantSpacingIntervalMeters(),
        commitPlantSpacingIntervalMeters: (meters) =>
          this._appAdapter.settings.commitPlantSpacingIntervalMeters(meters),
        translate: this._appAdapter.translate,
        getLocalizedCommonNames: () => this._presentation.getLocalizedCommonNames(),
        notifyTransientHistoryChange: () => this._notifyTransientHistoryChanged(),
        publishToolGuidance: setCanvasToolGuidance,
        nudge: this._commandSurface.sceneEdits,
        setHoveredTarget: (target) => {
          this._setHoveredTarget(target)
        },
        frames: this._construction.frames,
        viewNavigation: this._construction.viewNavigation,
        renderer: {
          setDraft: (draft) => this._rendering.setDraft(draft),
        },
        ...(this._appAdapter.focus ? { focus: this._appAdapter.focus } : {}),
      })
      const interaction = this._interaction
      bindQuerySurfacePointerWorld(this._querySurface, (listener) => interaction.subscribePointerWorld(listener))
      this._interaction.setOverviewMode(this._construction.frames.viewFrame.peek().mode === 'overview')
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

  /** The runtime's one camera: the workspace activation attaches each map to it; destroy disposes it. */
  get cameraHost(): CameraDriverHost {
    return this._construction.cameraHost
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

  /** The live interaction session's key handling, null before init and after the map unmounts (the surfaces forward to it). */
  get keyboardPort(): CanvasKeyboardPort | null {
    return this._interaction?.keyboard ?? null
  }

  /**
   * Internal workspace-lifecycle control, excluded from CanvasRuntimeSurfaces.
   * The map became unavailable: release the renderer and the interaction
   * session so nothing draws or edits blind. The Scene stays loaded, so the
   * Design can still be saved.
   */
  async unmountRenderer(): Promise<void> {
    const interaction = this._interaction
    this._interaction = null
    bindQuerySurfacePointerWorld(this._querySurface, null)
    try {
      interaction?.dispose()
    } finally {
      this._notifyTransientHistoryChanged()
      await this._rendering.unmount()
    }
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
    // The display is module state shared with drawing and hit testing; the next runtime starts from the default.
    this._disposeEffects.push(() => { setCanvasPlantDisplay(DEFAULT_PLANT_DISPLAY) })
    this._disposeEffects.push(...installSceneRuntimeEffects({
      onTheme: () => {
        const container = this._rendering.container
        if (container) {
          refreshCanvasColorCache(container)
        }
        this._chrome.refreshTheme()
        this._construction.inspection.refresh()
        this._invalidate('scene')
      },
      onLocale: () => {
        this._interaction?.refreshTranslations()
        this._construction.inspection.refresh()
        this._invalidate('scene')
      },
      onChromeOverlay: () => {
        this._renderChrome()
      },
      onMapBackdrop: (backdrop) => {
        if (!setCanvasMapBackdrop(backdrop)) return
        this._renderChrome()
        this._invalidate('scene')
      },
      onPlantDisplay: (display) => {
        if (!setCanvasPlantDisplay(display)) return
        this._construction.inspection.refresh()
        this._invalidate('scene')
      },
      plantDisplay: this._appAdapter.plantDisplay,
      onPanelTargetHover: () => {
        this._invalidate('scene')
      },
      frames: this._construction.frames,
      onCameraFrame: () => {
        const mode = this._construction.frames.viewFrame.peek().mode
        if (mode !== this._cameraMode) {
          this._cameraMode = mode
          this._interaction?.setOverviewMode(mode === 'overview')
          this._invalidate('scene')
          return
        }
        this._invalidate('viewport')
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
    // A write that reads nothing: the host bumps it from tool calls and settling commits inside the runtime's effects.
    this._transientHistoryRevision.value = this._transientHistoryRevision.peek() + 1
  }

  private _renderChrome(): void {
    const container = this._rendering.container
    if (!container) return
    const chromeSettings = this._appAdapter.settings.readChromeOverlay()
    this._chrome.update({
      frame: this._construction.frames.viewFrame.peek(),
      rulersVisible: chromeSettings.rulersVisible,
      gridVisible: chromeSettings.gridVisible,
      guidesVisible: chromeSettings.guidesVisible,
      guides: this._sceneState.guides,
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

/**
 * The Design map is aria-busy from a Design change until the renderer has drawn it, so
 * assistive technology and the Web browser checks can wait for the drawing; the DOM (chips,
 * tools, Undo) changes at once. Camera frames never mark it.
 */
function markBusyWhileScenePending(host: HTMLElement, scenePending: ReadonlySignal<boolean>): () => void {
  return effect(() => {
    if (!scenePending.value) return
    host.setAttribute('aria-busy', 'true')
    return () => host.removeAttribute('aria-busy')
  })
}
