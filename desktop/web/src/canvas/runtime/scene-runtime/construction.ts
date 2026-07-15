import { signal, type Signal } from '@preact/signals'
import {
  createDetachedCanvasRuntimeAppAdapter,
  type CanvasRuntimeAppAdapter,
} from '../app-adapter'
import { CameraController } from '../camera'
import { createSceneCanvasCommandSurface } from '../command-surface'
import { createSceneCanvasDocumentSurface } from '../document-surface'
import { createSceneCanvasQuerySurface } from '../query-surface'
import { RendererHost } from '../renderers'
import { createCanvas2DSceneRenderer } from '../renderers/canvas2d-scene'
import { createPixiSceneRenderer } from '../renderers/pixi-scene'
import type { SceneRendererContext, SceneRendererInstance } from '../renderers/scene-types'
import type {
  CanvasPlantLabelSource,
  CanvasSpeciesPresentationCache,
} from '../presentation-data'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQueryRevision,
  CanvasQuerySurface,
} from '../runtime'
import {
  SceneStore,
  type ScenePersistedState,
  type SceneSessionWriter,
  type SceneStateReader,
} from '../scene'
import { SceneHistory } from '../scene-history'
import { SceneRuntimeChromeCoordinator } from './chrome-coordinator'
import { SceneRuntimeDocumentBridge } from './document'
import {
  createDetachedSceneRuntimePanelTargetAdapter,
  type SceneRuntimePanelTargetAdapter,
} from './panel-target-adapter'
import { SceneRuntimeMutationController } from './mutations'
import { SceneRuntimePresentationController } from './presentation'
import { SceneRuntimeRenderScheduler } from './render-scheduler'
import {
  syncCanvasSignalsFromDocument,
} from './scene-sync'
import {
  SceneRuntimeEditCoordinator,
  type SceneCommandAdmission,
  type SceneEditCoordinator,
  type SettledSceneReader,
} from './transactions'
import { runCanvasRuntimeCleanups } from '../cleanup'

type RuntimeInvalidationKind = 'scene' | 'viewport' | 'chrome'

export interface SceneRuntimeConstructionOptions {
  appAdapter?: CanvasRuntimeAppAdapter
  targetPresentation?: SceneRuntimePanelTargetAdapter
  speciesCache?: CanvasSpeciesPresentationCache
  plantLabels?: CanvasPlantLabelSource
}

export interface SceneRuntimeConstructionCallbacks {
  readonly resolveHighlightedTargets: (
    scene: ScenePersistedState,
  ) => { plantIds: readonly string[]; zoneIds: readonly string[] }
  readonly incrementPlantNamesRevision: () => void
  readonly setSelection: (ids: Iterable<string>) => void
  readonly prepareForDocumentReplacement: () => void
  readonly syncHoveredCanvasTargets: (id: string | null) => void
  readonly syncCanvasSignalsFromScene: () => void
  readonly invalidate: (kind: RuntimeInvalidationKind) => void
  readonly incrementSceneRevision: () => void
  readonly renderChrome: () => void
  readonly addGuide: (axis: 'h' | 'v', worldPosition: number) => void
  readonly setHoveredEntityId: (id: string | null, options?: { invalidate?: boolean }) => void
  readonly notifyTransientHistoryChanged: () => void
  readonly canUndoTransientHistory: () => boolean
  readonly canRedoTransientHistory: () => boolean
  readonly undoTransientHistory: () => boolean
  readonly redoTransientHistory: () => boolean
  readonly setInteractionTool: (name: string) => void
  readonly disposeInteraction: () => void
}

export interface SceneRuntimeConstruction {
  readonly sceneState: SceneStateReader
  readonly sceneSession: SceneSessionWriter
  readonly camera: CameraController
  readonly sceneRevision: Signal<number>
  readonly plantNamesQueryRevision: Signal<number>
  readonly transientHistoryRevision: Signal<number>
  readonly revision: CanvasQueryRevision
  readonly rendererHost: RendererHost<SceneRendererContext, SceneRendererInstance>
  readonly replaceRendererHost: (
    rendererHost: RendererHost<SceneRendererContext, SceneRendererInstance>,
  ) => void
  readonly rendering: SceneRuntimeRenderScheduler
  readonly presentation: SceneRuntimePresentationController
  readonly chrome: SceneRuntimeChromeCoordinator
  readonly appAdapter: CanvasRuntimeAppAdapter
  readonly commandSurface: CanvasCommandSurface
  readonly sceneCommands: SceneEditCoordinator & SceneCommandAdmission
  readonly settledReader: SettledSceneReader
  readonly documentSurface: CanvasDocumentSurface
  readonly querySurface: CanvasQuerySurface
  readonly panelTargetAdapter: SceneRuntimePanelTargetAdapter
  readonly disposeEffects: Array<() => void>
}

export function createSceneRuntimeConstruction(
  options: SceneRuntimeConstructionOptions,
  callbacks: SceneRuntimeConstructionCallbacks,
): SceneRuntimeConstruction {
  const sceneStore = new SceneStore()
  const camera = new CameraController()
  const sceneRevision = signal(0)
  const plantNamesQueryRevision = signal(0)
  const transientHistoryRevision = signal(0)
  let runtimeActive = true
  const revision: CanvasQueryRevision = {
    scene: sceneRevision,
    plantNames: plantNamesQueryRevision,
  }
  let rendererHost = new RendererHost<SceneRendererContext, SceneRendererInstance>({
    backends: [
      createPixiSceneRenderer(),
      createCanvas2DSceneRenderer(),
    ],
  })
  const appAdapter = options.appAdapter ?? createDetachedCanvasRuntimeAppAdapter()
  const history = new SceneHistory({
    reportCleanState: (clean) => appAdapter.cleanState.setCanvasClean(clean),
  })
  const sceneEdits = new SceneRuntimeEditCoordinator({
    sceneStore,
    history,
    setSelection: callbacks.setSelection,
    incrementSceneRevision: callbacks.incrementSceneRevision,
    syncCanvasSignalsFromScene: callbacks.syncCanvasSignalsFromScene,
    invalidate: callbacks.invalidate,
  })
  const settledReader: SettledSceneReader = sceneEdits
  const panelTargetAdapter =
    options.targetPresentation ?? createDetachedSceneRuntimePanelTargetAdapter()
  const presentationData = appAdapter.presentationData
  const presentation = new SceneRuntimePresentationController({
    sceneStore,
    getViewport: () => camera.viewport,
    getLocale: () => appAdapter.settings.readLocale(),
    resolveHighlightedTargets: callbacks.resolveHighlightedTargets,
    onPlantNamesChanged: callbacks.incrementPlantNamesRevision,
    speciesCache: options.speciesCache ?? presentationData?.speciesCache,
    plantLabels: options.plantLabels ?? presentationData?.plantLabels,
  })
  const chrome = new SceneRuntimeChromeCoordinator()
  const disposeEffects: Array<() => void> = []
  const rendering = new SceneRuntimeRenderScheduler({
    getRendererHost: () => rendererHost,
    getViewport: () => camera.viewport,
    prepareSceneRender: async () => {
      const ticket = sceneEdits.issueTicket()
      const refresh = await presentation.refreshCurrentPresentationData()
      return {
        publish: () => {
          presentation.publishRefresh(refresh)
          if (!refresh.failure) sceneEdits.applyBackfills(ticket, refresh.backfills)
          return presentation.buildRendererSnapshot()
        },
      }
    },
    renderChrome: callbacks.renderChrome,
  })
  const documents = new SceneRuntimeDocumentBridge({
    authority: sceneEdits,
    prepareForDocumentReplacement: callbacks.prepareForDocumentReplacement,
    clearHoveredTargets: () => callbacks.syncHoveredCanvasTargets(null),
    clearPanelOriginTargets: () => panelTargetAdapter.clearPanelOriginTargets(),
    composeDocumentForSave: (input) => appAdapter.document.composeDocumentForSave(input),
    syncCanvasSignalsFromDocument: (file) =>
      syncCanvasSignalsFromDocument(file, appAdapter.settings.layerProjections),
  })
  const documentSurface = createSceneCanvasDocumentSurface({
    documents,
    camera,
    chrome,
    rendering,
    getSceneSnapshot: () => sceneStore.persisted,
    createPlantPresentationContext: (viewportScale) =>
      presentation.createPlantPresentationContext(viewportScale),
    invalidateViewport: () => callbacks.invalidate('viewport'),
    renderChrome: callbacks.renderChrome,
    addGuide: callbacks.addGuide,
    clearHoveredEntity: () => callbacks.setHoveredEntityId(null, { invalidate: false }),
    disposeRuntime: () => {
      runtimeActive = false
      sceneEdits.disposePersistence()
    },
    disposeInteraction: callbacks.disposeInteraction,
    disposeEffects: () => {
      runCanvasRuntimeCleanups(
        disposeEffects.splice(0),
        'Scene Canvas runtime effect disposal failed',
      )
    },
  })
  const mutations = new SceneRuntimeMutationController({
    sceneStore,
    selection: {
      set: callbacks.setSelection,
    },
    sceneEdits,
    commandAdmission: sceneEdits,
    settledReader,
    presentation: {
      getViewportScale: () => camera.viewport.scale,
      createPlantPresentationContext: (viewportScale) =>
        presentation.createPlantPresentationContext(viewportScale),
      getLocalizedCommonNames: () => presentation.getLocalizedCommonNames(),
      getSuggestedPlantColor: (canonicalName) =>
        presentation.getSuggestedPlantColor(canonicalName),
    },
    invalidateScene: () => callbacks.invalidate('scene'),
  })
  const commandSurface = createSceneCanvasCommandSurface({
    sceneStore,
    camera,
    history: sceneEdits,
    commandAdmission: sceneEdits,
    settledReader,
    savedObjectStamps: appAdapter.savedObjectStamps,
    transientHistory: {
      revision: transientHistoryRevision,
      canUndo: callbacks.canUndoTransientHistory,
      canRedo: callbacks.canRedoTransientHistory,
      undo: callbacks.undoTransientHistory,
      redo: callbacks.redoTransientHistory,
    },
    mutations,
    sceneEdits,
    presentationMaintenance: sceneEdits,
    presentation,
    settings: appAdapter.settings,
    setInteractionTool: callbacks.setInteractionTool,
    invalidate: callbacks.invalidate,
    isRuntimeActive: () => runtimeActive,
  })
  const querySurface = createSceneCanvasQuerySurface({
    revision,
    sceneStore,
    camera,
    settledReader,
    mutations,
    presentation,
  })

  return {
    sceneState: sceneStore,
    sceneSession: sceneStore,
    camera,
    sceneRevision,
    plantNamesQueryRevision,
    transientHistoryRevision,
    revision,
    get rendererHost() {
      return rendererHost
    },
    replaceRendererHost(nextRendererHost) {
      rendererHost = nextRendererHost
    },
    rendering,
    presentation,
    chrome,
    appAdapter,
    commandSurface,
    sceneCommands: sceneEdits,
    settledReader,
    documentSurface,
    querySurface,
    panelTargetAdapter,
    disposeEffects,
  }
}
