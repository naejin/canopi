import { effect } from '@preact/signals'
import { throwCanvasRuntimeCleanupErrors } from '../../canvas/runtime/cleanup'
import { createCanvas2DSceneRenderer } from '../../canvas/runtime/renderers/canvas2d-scene'
import type { CanvasRuntimeAppAdapter } from '../../canvas/runtime/app-adapter'
import type { SceneRuntimePanelTargetAdapter } from '../../canvas/runtime/scene-runtime/panel-target-adapter'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasRuntimeSurfaces,
} from '../../canvas/runtime/runtime'
import {
  SceneCanvasRuntime,
  type SceneCanvasRuntimeOptions,
} from '../../canvas/runtime/scene-runtime'
import {
  createSharedMapSceneRendererComposition,
  type SharedMapSceneRendererComposition,
} from '../../maplibre/shared-scene-renderer'
import { MapLibreWorkspaceCameraOwner } from '../../maplibre/workspace-camera'
import type { WorkspaceBasemapPresentation } from '../../maplibre/workspace-map'
import {
  WorkspaceActivationCoordinator,
  type WorkspaceActivationOptions,
  type WorkspaceActivationOutcome,
  type WorkspaceActivationRuntime,
} from './workspace-activation'
import { readWorkspaceActivationSnapshot, readWorkspaceBasemapPresentation } from './workspace-activation-snapshot'
import { createWorkspaceDocumentSurface } from './workspace-document-surface'
import {
  WorkspaceGenerationReconciler,
  type WorkspaceGenerationLifecycle,
} from './workspace-generation-reconciler'
import { WorkspaceMapControls } from './workspace-map-controls'
import type { WorkspaceActivationMapControls, WorkspaceActivationSnapshot } from './workspace-activation'

export type WorkspaceRuntimeStartOutcome = WorkspaceActivationOutcome | 'no-design'

export interface WorkspaceRuntimeComposition {
  readonly surfaces: CanvasRuntimeSurfaces
  start(): Promise<WorkspaceRuntimeStartOutcome>
  dispose(): Promise<void>
}

export interface WorkspaceRuntimeCompositionOptions {
  readonly container: HTMLElement
  readonly appAdapter: CanvasRuntimeAppAdapter
  readonly targetPresentation: SceneRuntimePanelTargetAdapter
  readonly onFailure?: (error: unknown) => void
  readonly readSnapshot?: () => WorkspaceActivationSnapshot | null
  readonly readBasemapPresentation?: () => ReturnType<typeof readWorkspaceBasemapPresentation>
}

interface WorkspaceCompositionRuntime extends WorkspaceActivationRuntime {
  readonly commandSurface: CanvasCommandSurface
  readonly querySurface: CanvasQuerySurface
  readonly documentSurface: CanvasDocumentSurface
}

interface WorkspaceCompositionLifecycle extends WorkspaceGenerationLifecycle {
  updateBasemapPresentation(presentation: WorkspaceBasemapPresentation): void
}

/** Constructor-only test seam. Production callers use the default cohesive assembly. */
interface WorkspaceRuntimeCompositionDependencies {
  readonly createRendererComposition: () => SharedMapSceneRendererComposition
  readonly createCamera: () => MapLibreWorkspaceCameraOwner
  readonly createRuntime: (options: SceneCanvasRuntimeOptions) => WorkspaceCompositionRuntime
  readonly createControls: (container: HTMLElement) => WorkspaceActivationMapControls
  readonly createWorkspace: (options: WorkspaceActivationOptions) => WorkspaceCompositionLifecycle
  readonly installEffect: (callback: () => void) => () => void
}

const DEFAULT_DEPENDENCIES: WorkspaceRuntimeCompositionDependencies = {
  createRendererComposition: createSharedMapSceneRendererComposition,
  createCamera: () => new MapLibreWorkspaceCameraOwner(),
  createRuntime: (options) => new SceneCanvasRuntime(options),
  createControls: (container) => new WorkspaceMapControls({ container }),
  createWorkspace: (options) => new WorkspaceActivationCoordinator(options),
  installEffect: effect,
}

/**
 * App-owned composition for the qualified shared MapLibre runtime. It remains
 * unmounted until the edition lifecycle migration adopts this surface.
 */
export function createWorkspaceRuntimeComposition(
  options: WorkspaceRuntimeCompositionOptions,
  dependencyOverrides: Partial<WorkspaceRuntimeCompositionDependencies> = {},
): WorkspaceRuntimeComposition {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  const rendererComposition = dependencies.createRendererComposition()
  const camera = dependencies.createCamera()
  const runtime = dependencies.createRuntime({
    camera,
    appAdapter: options.appAdapter,
    targetPresentation: options.targetPresentation,
    renderer: {
      backends: [rendererComposition.renderer, createCanvas2DSceneRenderer()],
    },
  })
  const controls = dependencies.createControls(options.container)
  const workspace = dependencies.createWorkspace({
    container: options.container,
    runtime,
    camera,
    composition: rendererComposition,
    map: controls,
    layer: {},
  })
  const reconciler = new WorkspaceGenerationReconciler({
    workspace,
    readSnapshot: options.readSnapshot ?? readWorkspaceActivationSnapshot,
    onFailure: options.onFailure,
    onOutcome: (outcome) => initializeViewport(outcome),
  })
  const documents = createWorkspaceDocumentSurface({
    documents: runtime.documentSurface,
    reconciler,
  })
  const surfaces: CanvasRuntimeSurfaces = {
    commands: runtime.commandSurface,
    queries: runtime.querySurface,
    documents,
  }
  let startResult: Promise<WorkspaceRuntimeStartOutcome> | null = null
  let cancelledStartResult: Promise<WorkspaceRuntimeStartOutcome> | null = null
  let disposeResult: Promise<void> | null = null
  let disposePresentationEffect: (() => void) | null = null
  let viewportInitialized = false
  let viewportReady = false

  const initializeViewport = (outcome: WorkspaceRuntimeStartOutcome): WorkspaceRuntimeStartOutcome => {
    if (viewportReady || outcome === 'no-design' || outcome === 'cancelled') return outcome
    if (!viewportInitialized) {
      documents.initializeViewport()
      viewportInitialized = true
    }
    if (documents.hasLoadedDocument()) documents.zoomToFit()
    viewportReady = true
    return outcome
  }

  return {
    surfaces,
    start() {
      if (disposeResult) {
        cancelledStartResult ??= Promise.resolve('cancelled')
        return cancelledStartResult
      }
      if (startResult) return startResult
      let resolveStart!: (outcome: WorkspaceRuntimeStartOutcome) => void
      startResult = new Promise((resolve) => {
        resolveStart = resolve
      })
      try {
        disposePresentationEffect = dependencies.installEffect(() => {
          workspace.updateBasemapPresentation(
            (options.readBasemapPresentation ?? readWorkspaceBasemapPresentation)(),
          )
        })
        void reconciler.reconcileInitialGeneration().then(
          resolveStart,
          (error: unknown) => {
            reportCompositionFailure(options.onFailure, error)
            resolveStart('cancelled')
          },
        )
      } catch (error) {
        reportCompositionFailure(options.onFailure, error)
        resolveStart('cancelled')
      }
      return startResult
    },
    dispose() {
      if (disposeResult) return disposeResult
      let resolveDispose!: () => void
      let rejectDispose!: (error: unknown) => void
      disposeResult = new Promise<void>((resolve, reject) => {
        resolveDispose = resolve
        rejectDispose = reject
      })
      const presentationEffect = disposePresentationEffect
      disposePresentationEffect = null
      void (async () => {
        const errors: unknown[] = []
        try {
          presentationEffect?.()
        } catch (error) {
          errors.push(error)
        }
        try {
          await reconciler.dispose()
        } catch (error) {
          errors.push(error)
        }
        throwCanvasRuntimeCleanupErrors(errors, 'Shared workspace composition teardown failed')
      })().then(resolveDispose, rejectDispose)
      return disposeResult
    },
  }
}

function reportCompositionFailure(
  observer: ((error: unknown) => void) | undefined,
  error: unknown,
): void {
  try {
    if (observer) observer(error)
    else console.error('Shared workspace composition failed:', error)
  } catch (observerError) {
    console.error('Shared workspace failure observer failed:', observerError)
  }
}
