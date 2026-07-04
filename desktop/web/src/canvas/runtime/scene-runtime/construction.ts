import { signal, type Signal } from '@preact/signals'
import {
  createDetachedCanvasRuntimeAppAdapter,
  type CanvasRuntimeAppAdapter,
} from '../app-adapter'
import { syncPlantSpeciesColorDefaults } from '../../plant-species-color-defaults'
import { CameraController } from '../camera'
import { createSceneCanvasCommandSurface } from '../command-surface'
import { createSceneCanvasDocumentSurface } from '../document-surface'
import { createSceneCanvasQuerySurface } from '../query-surface'
import { RendererHost } from '../renderers'
import { createCanvas2DSceneRenderer } from '../renderers/canvas2d-scene'
import { createPixiSceneRenderer } from '../renderers/pixi-scene'
import type { SceneRendererContext, SceneRendererInstance } from '../renderers/scene-types'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQueryRevision,
  CanvasQuerySurface,
} from '../runtime'
import { SceneStore, type ScenePersistedState, type SceneViewportState } from '../scene'
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
  type SceneEditCoordinator,
} from './transactions'

type RuntimeInvalidationKind = 'scene' | 'viewport' | 'chrome'

export interface SceneRuntimeConstructionOptions {
  appAdapter?: CanvasRuntimeAppAdapter
  targetPresentation?: SceneRuntimePanelTargetAdapter
}

export interface SceneRuntimeConstructionCallbacks {
  readonly resolveHighlightedTargets: (
    scene: ScenePersistedState,
  ) => { plantIds: readonly string[]; zoneIds: readonly string[] }
  readonly currentPresentationRevision: () => number
  readonly applyPresentationBackfillsIfCurrent: (
    expectedRevision: number,
    backfills: Parameters<SceneRuntimeDocumentBridge['applyPresentationBackfills']>[0],
  ) => boolean
  readonly incrementPlantNamesRevision: () => void
  readonly setSelection: (ids: Iterable<string>) => void
  readonly resetTransientRuntimeState: () => void
  readonly syncHoveredCanvasTargets: (id: string | null) => void
  readonly syncCanvasSignalsFromScene: () => void
  readonly invalidate: (kind: RuntimeInvalidationKind) => void
  readonly incrementSceneRevision: () => void
  readonly incrementViewportRevision: () => void
  readonly setViewport: (
    viewport: SceneViewportState,
    options?: { forceRevision?: boolean },
  ) => void
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
  readonly sceneStore: SceneStore
  readonly camera: CameraController
  readonly sceneRevision: Signal<number>
  readonly plantNamesQueryRevision: Signal<number>
  readonly viewportRevision: Signal<number>
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
  readonly history: SceneHistory
  readonly commandSurface: CanvasCommandSurface
  readonly sceneEdits: SceneEditCoordinator
  readonly mutations: SceneRuntimeMutationController
  readonly documents: SceneRuntimeDocumentBridge
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
  const viewportRevision = signal(0)
  const transientHistoryRevision = signal(0)
  const revision: CanvasQueryRevision = {
    scene: sceneRevision,
    plantNames: plantNamesQueryRevision,
    viewport: viewportRevision,
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
  const panelTargetAdapter =
    options.targetPresentation ?? createDetachedSceneRuntimePanelTargetAdapter()
  const presentation = new SceneRuntimePresentationController({
    sceneStore,
    getViewport: () => camera.viewport,
    getLocale: () => appAdapter.settings.readLocale(),
    resolveHighlightedTargets: callbacks.resolveHighlightedTargets,
    onPlantNamesChanged: callbacks.incrementPlantNamesRevision,
  })
  const chrome = new SceneRuntimeChromeCoordinator()
  const disposeEffects: Array<() => void> = []
  const rendering = new SceneRuntimeRenderScheduler({
    getRendererHost: () => rendererHost,
    getViewport: () => camera.viewport,
    prepareSceneSnapshot: async () => {
      const presentationRevision = callbacks.currentPresentationRevision()
      const snapshot = await presentation.refreshCurrentPresentationData()
      callbacks.applyPresentationBackfillsIfCurrent(
        presentationRevision,
        snapshot.backfills,
      )
      return presentation.buildRendererSnapshot()
    },
    renderChrome: callbacks.renderChrome,
  })
  const documents = new SceneRuntimeDocumentBridge({
    sceneStore,
    history,
    setSelection: callbacks.setSelection,
    resetTransientRuntimeState: callbacks.resetTransientRuntimeState,
    clearHoveredTargets: () => callbacks.syncHoveredCanvasTargets(null),
    clearPanelOriginTargets: () => panelTargetAdapter.clearPanelOriginTargets(),
    composeDocumentForSave: (input) => appAdapter.document.composeDocumentForSave(input),
    syncCanvasSignalsFromDocument: (file) =>
      syncCanvasSignalsFromDocument(file, appAdapter.settings.layerProjections),
    syncCanvasSignalsFromScene: callbacks.syncCanvasSignalsFromScene,
    invalidateScene: () => callbacks.invalidate('scene'),
    incrementSceneRevision: callbacks.incrementSceneRevision,
    incrementViewportRevision: callbacks.incrementViewportRevision,
  })
  const documentSurface = createSceneCanvasDocumentSurface({
    documents,
    camera,
    chrome,
    rendering,
    getSceneSnapshot: () => sceneStore.persisted,
    createPlantPresentationContext: (viewportScale) =>
      presentation.createPlantPresentationContext(viewportScale),
    setViewport: callbacks.setViewport,
    invalidateViewport: () => callbacks.invalidate('viewport'),
    renderChrome: callbacks.renderChrome,
    addGuide: callbacks.addGuide,
    clearHoveredEntity: () => callbacks.setHoveredEntityId(null, { invalidate: false }),
    disposeInteraction: callbacks.disposeInteraction,
    disposeEffects: () => {
      for (const dispose of disposeEffects.splice(0)) dispose()
    },
  })
  const sceneEdits = new SceneRuntimeEditCoordinator({
    sceneStore,
    captureSnapshot: () => documents.captureCommandSnapshot(),
    markDirty: (before, type) => documents.markDirty(before, type),
    setSelection: callbacks.setSelection,
    invalidate: callbacks.invalidate,
  })
  const mutations = new SceneRuntimeMutationController({
    sceneStore,
    selection: {
      set: callbacks.setSelection,
    },
    sceneEdits,
    presentation: {
      syncPlantSpeciesColors: () =>
        syncPlantSpeciesColorDefaults(sceneStore.persisted.plantSpeciesColors),
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
    history,
    transientHistory: {
      revision: transientHistoryRevision,
      canUndo: callbacks.canUndoTransientHistory,
      canRedo: callbacks.canRedoTransientHistory,
      undo: callbacks.undoTransientHistory,
      redo: callbacks.redoTransientHistory,
    },
    documents,
    mutations,
    sceneEdits,
    presentation,
    settings: appAdapter.settings,
    setViewport: callbacks.setViewport,
    setInteractionTool: callbacks.setInteractionTool,
    syncCanvasSignalsFromScene: callbacks.syncCanvasSignalsFromScene,
    incrementSceneRevision: callbacks.incrementSceneRevision,
    currentPresentationRevision: callbacks.currentPresentationRevision,
    invalidate: callbacks.invalidate,
  })
  const querySurface = createSceneCanvasQuerySurface({
    revision,
    sceneStore,
    camera,
    viewportRevision,
    mutations,
    presentation,
  })

  return {
    sceneStore,
    camera,
    sceneRevision,
    plantNamesQueryRevision,
    viewportRevision,
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
    history,
    commandSurface,
    sceneEdits,
    mutations,
    documents,
    documentSurface,
    querySurface,
    panelTargetAdapter,
    disposeEffects,
  }
}
