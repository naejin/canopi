import type { SpeciesFocus } from '../species-key'
import { effect, signal, type Signal } from '@preact/signals'
import {
  createDetachedCanvasRuntimeAppAdapter,
  type CanvasRuntimeAppAdapter,
} from '../app-adapter'
import {
  CameraController,
  type WorkspaceCameraFrameReader,
  type WorkspaceCameraNavigation,
  type WorkspaceCameraOwner,
} from '../camera'
import { createSceneCanvasCommandSurface } from '../command-surface'
import { createSceneCanvasDocumentSurface } from '../document-surface'
import { createSceneCanvasQuerySurface } from '../query-surface'
import { SceneCanvasInspectionOwner } from '../inspection-lens'
import type { SceneRendererDefinition } from '../renderers/scene-types'
import type {
  CanvasPlantLabelSource,
  CanvasSpeciesPresentationCache,
} from '../presentation-data'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasPlantRowSpacingField,
  CanvasQueryRevision,
  CanvasQuerySurface,
} from '../runtime'
import {
  SceneStore,
  type SceneDesignObjectTarget,
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
import { SceneRuntimeReoriginController } from './reorigin'
import { DEFAULT_NEW_DESIGN_VIEW } from '../../session-plane'
import { mapZoomToStageScale } from '../../projection'
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
import { getRevealedAnnotationId } from '../annotation-layout'
import { sceneExtentPoints, selectionExtentPoints } from '../scene-extent'
import { createViewNavigation, type ViewNavigation } from '../view/navigation'
import type { ViewFrameSource } from '../view/types'

type RuntimeInvalidationKind = 'scene' | 'viewport' | 'chrome'

export interface SceneRuntimeConstructionOptions {
  appAdapter?: CanvasRuntimeAppAdapter
  camera?: WorkspaceCameraOwner
  targetPresentation?: SceneRuntimePanelTargetAdapter
  speciesCache?: CanvasSpeciesPresentationCache
  plantLabels?: CanvasPlantLabelSource
  /** The one scene renderer (ADR 0004). A runtime without one keeps its Scene but cannot mount. */
  renderer?: SceneRendererDefinition
}

export interface SceneRuntimeConstructionCallbacks {
  readonly resolveHighlightedTargets: (
    scene: ScenePersistedState,
  ) => { plantIds: readonly string[]; zoneIds: readonly string[] }
  readonly incrementPlantNamesRevision: () => void
  readonly setSelection: (targets: Iterable<SceneDesignObjectTarget>) => void
  readonly prepareForDocumentReplacement: () => void
  readonly syncHoveredCanvasTargets: (target: SceneDesignObjectTarget | null) => void
  readonly syncCanvasSignalsFromScene: () => void
  readonly invalidate: (kind: RuntimeInvalidationKind) => void
  readonly incrementSceneRevision: () => void
  readonly renderChrome: () => void
  readonly addGuide: (axis: 'h' | 'v', worldPosition: number) => void
  readonly setHoveredTarget: (
    target: SceneDesignObjectTarget | null,
    options?: { invalidate?: boolean },
  ) => void
  readonly notifyTransientHistoryChanged: () => void
  readonly canUndoTransientHistory: () => boolean
  readonly canRedoTransientHistory: () => boolean
  readonly undoTransientHistory: () => boolean
  readonly redoTransientHistory: () => boolean
  readonly setInteractionTool: (name: string) => void
  readonly readInteractionTool: () => string | null
  readonly plantRowSpacing: CanvasPlantRowSpacingField
  readonly disposeInteraction: () => void
}

export interface SceneRuntimeConstruction {
  readonly sceneState: SceneStateReader
  readonly sceneSession: SceneSessionWriter
  readonly camera: WorkspaceCameraFrameReader
  readonly cameraNavigation: WorkspaceCameraNavigation
  /** The camera driver host's frames and the navigation over it, which the interaction session hands its ToolHost (0B). */
  readonly frames: ViewFrameSource
  readonly viewNavigation: ViewNavigation
  readonly sceneRevision: Signal<number>
  readonly plantNamesQueryRevision: Signal<number>
  readonly transientHistoryRevision: Signal<number>
  readonly revision: CanvasQueryRevision
  /** Test seam: supplies the renderer the next mount uses. */
  readonly replaceRenderer: (renderer: SceneRendererDefinition) => void
  readonly rendering: SceneRuntimeRenderScheduler
  readonly presentation: SceneRuntimePresentationController
  readonly inspection: SceneCanvasInspectionOwner
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
  const appAdapter = options.appAdapter ?? createDetachedCanvasRuntimeAppAdapter()
  const readEmptyDesignView = () => appAdapter.settings.readLastView?.() ?? DEFAULT_NEW_DESIGN_VIEW
  const sceneStore = new SceneStore(undefined, {}, () => {
    const view = readEmptyDesignView()
    return { lon: view.lon, lat: view.lat }
  })
  // Fitting an empty Design shows the new-Design overview: its centre is the plane origin.
  const readEmptySceneScale = () => mapZoomToStageScale(
    readEmptyDesignView().zoom,
    sceneStore.sessionPlane.origin.lat,
  )
  const cameraOwner = options.camera ?? new CameraController()
  const camera = cameraOwner.frame
  const cameraNavigation = cameraOwner.navigation
  // The shim wraps the runtime's one camera: its driver host feeds the view surfaces (0A to the end of 0D2).
  const cameraHost = cameraOwner.host
  const readViewScale = () => cameraHost.frames.viewFrame.peek().view.pixelsPerMetre
  const sceneRevision = signal(0)
  const plantNamesQueryRevision = signal(0)
  const transientHistoryRevision = signal(0)
  let runtimeActive = true
  const revision: CanvasQueryRevision = {
    scene: sceneRevision,
    plantNames: plantNamesQueryRevision,
  }
  let renderer: SceneRendererDefinition | null = options.renderer ?? null
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
    readPixelsPerMetre: readViewScale,
    getLocale: () => appAdapter.settings.readLocale(),
    resolveHighlightedTargets: callbacks.resolveHighlightedTargets,
    onPlantNamesChanged: callbacks.incrementPlantNamesRevision,
    speciesCache: options.speciesCache ?? presentationData?.speciesCache,
    plantLabels: options.plantLabels ?? presentationData?.plantLabels,
  })
  const chrome = new SceneRuntimeChromeCoordinator()
  const disposeEffects: Array<() => void> = []
  disposeEffects.push(cameraOwner.followScenePlane(sceneStore.sessionPlaneSignal))
  const rendering = new SceneRuntimeRenderScheduler({
    getRenderer: () => renderer,
    getView: () => cameraHost.frames.viewFrame.peek().view,
    prepareSceneRender: async () => {
      if (cameraHost.frames.viewFrame.peek().mode === 'overview') {
        return {
          publish: () => presentation.buildRendererSnapshot({ overview: true }),
        }
      }
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
  const inspection = new SceneCanvasInspectionOwner({
    frames: cameraHost.frames,
    revision,
    readSessionPlane: () => sceneStore.sessionPlane,
    getSnapshot: () => presentation.buildRendererSnapshot(),
    setHoveredTarget: callbacks.setHoveredTarget,
  })
  const documentSurface = createSceneCanvasDocumentSurface({
    readEmptySceneScale,
    inspection,
    documents,
    camera,
    cameraNavigation,
    chrome,
    rendering,
    getSceneSnapshot: () => sceneStore.persisted,
    createPlantPresentationContext: (viewportScale) =>
      presentation.createPlantPresentationContext(viewportScale),
    invalidateViewport: () => callbacks.invalidate('viewport'),
    renderChrome: callbacks.renderChrome,
    addGuide: callbacks.addGuide,
    clearHoveredEntity: () => callbacks.setHoveredTarget(null, { invalidate: false }),
    disposeRuntime: () => {
      runtimeActive = false
      sceneEdits.disposePersistence()
    },
    disposeInteraction: callbacks.disposeInteraction,
    disposeCamera: () => cameraOwner.dispose(),
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
      getViewportScale: readViewScale,
      createPlantPresentationContext: (viewportScale) =>
        presentation.createPlantPresentationContext(viewportScale),
      getLocalizedCommonNames: () => presentation.getLocalizedCommonNames(),
      getSuggestedPlantColor: (canonicalName) =>
        presentation.getSuggestedPlantColor(canonicalName),
    },
    invalidateScene: () => callbacks.invalidate('scene'),
  })
  const reorigin = new SceneRuntimeReoriginController({
    sceneState: sceneStore,
    authority: sceneEdits,
    commandAdmission: sceneEdits,
    cameraNavigation,
  })
  // Each published camera snapshot re-reads the live frame's centre; a plane that only followed a hydration publishes none.
  disposeEffects.push(effect(() => {
    void camera.snapshot.value
    reorigin.observe(cameraHost.frames.viewFrame.peek())
  }))
  disposeEffects.push(() => reorigin.dispose())
  const focusSpecies = (canonicalName: string | null) => {
    if (!runtimeActive) return
    const current = sceneStore.session.speciesFocus
    const next: SpeciesFocus = { canonicalName }
    if (canonicalName !== null && !sceneStore.persisted.plants.some((plant) => plant.canonicalName === canonicalName)) return
    if (current.canonicalName === next.canonicalName) return
    sceneStore.updateSession((draft) => { draft.speciesFocus = next })
    callbacks.incrementSceneRevision()
    callbacks.invalidate('scene')
  }
  const viewNavigation = createViewNavigation({
    driver: cameraHost,
    policy: cameraHost.driverDeps.policy,
    readScene: () => {
      const persisted = sceneStore.persisted
      const scale = readViewScale()
      const plantContext = presentation.createPlantPresentationContext(scale)
      // The objects the selection model frames (editable and locked), by their outlines at the live scale.
      const { editableTargets, lockedTargets } = querySurface.getDesignObjectSelection()
      return {
        persisted,
        selection: selectionExtentPoints(persisted, [...editableTargets, ...lockedTargets], {
          plantContext,
          revealedAnnotationId: getRevealedAnnotationId(sceneStore.session.selectedTargets),
        })(scale),
        bounds: {
          extentPoints: sceneExtentPoints(persisted, plantContext),
          emptySceneScale: readEmptySceneScale(),
        },
      }
    },
  })
  const commandSurface = createSceneCanvasCommandSurface({
    readEmptySceneScale,
    speciesFocus: {
      focus: focusSpecies,
    },
    sceneStore,
    camera,
    cameraNavigation,
    viewNavigation,
    readViewScale,
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
    readInteractionTool: callbacks.readInteractionTool,
    plantRowSpacing: callbacks.plantRowSpacing,
    invalidate: callbacks.invalidate,
    isRuntimeActive: () => runtimeActive,
    isSpatialEditingEnabled: () => camera.snapshot.peek().mode === 'site',
  })
  const querySurface = createSceneCanvasQuerySurface({
    revision,
    sceneStore,
    camera: { snapshot: camera.snapshot, host: cameraHost },
    readViewScale,
    settledReader,
    mutations,
    presentation,
  })

  return {
    inspection,
    sceneState: sceneStore,
    sceneSession: sceneStore,
    camera,
    cameraNavigation,
    frames: cameraHost.frames,
    viewNavigation,
    sceneRevision,
    plantNamesQueryRevision,
    transientHistoryRevision,
    revision,
    replaceRenderer(nextRenderer) {
      renderer = nextRenderer
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
