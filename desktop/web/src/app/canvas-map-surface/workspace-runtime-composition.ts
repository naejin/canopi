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
import type { MapBackgroundPresentation } from '../../maplibre/map-background'
import {
  WorkspaceActivationCoordinator,
  type WorkspaceActivationOptions,
  type WorkspaceActivationOutcome,
  type WorkspaceActivationRuntime,
} from './workspace-activation'
import { readWorkspaceActivationSnapshot, readWorkspaceBackgroundPresentation } from './workspace-activation-snapshot'
import { createWorkspaceDocumentSurface } from './workspace-document-surface'
import {
  WorkspaceGenerationReconciler,
  type WorkspaceGenerationLifecycle,
} from './workspace-generation-reconciler'
import { WorkspaceMapControls } from './workspace-map-controls'
import type { WorkspaceActivationMapControls, WorkspaceActivationSnapshot } from './workspace-activation'
import type { WorkspaceMapContributionAdapter, WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'
import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'
import { DEFAULT_NEW_DESIGN_VIEW, type SessionPlane } from '../../canvas/session-plane'
import { stageScaleToMapZoom, viewportCenterWorld } from '../../canvas/projection'
import type { CameraViewportSnapshot } from '../../canvas/runtime/camera'

export type WorkspaceRuntimeStartOutcome = WorkspaceActivationOutcome | 'no-design'

export interface WorkspaceRuntimeComposition {
  readonly surfaces: CanvasRuntimeSurfaces
  start(): Promise<WorkspaceRuntimeStartOutcome>
  dispose(): Promise<void>
}

/**
 * The only details an edition mount supplies to the shared workspace. Edition
 * factories bind application adapters and contribution policy behind this
 * small mount-facing contract.
 */
export interface WorkspaceRuntimeMountOptions {
  readonly container: HTMLElement
  readonly onMapStateChange?: (state: MapLibreCanvasSurfaceState) => void
  readonly onFailure?: (error: unknown) => void
}

/** The geographic view a settled camera shows, for the app's last-view setting. */
export interface WorkspaceSettledView {
  readonly lon: number
  readonly lat: number
  readonly zoom: number
}

export const WORKSPACE_VIEW_SETTLE_MS = 750

export interface WorkspaceRuntimeCompositionOptions {
  readonly container: HTMLElement
  readonly appAdapter: CanvasRuntimeAppAdapter
  readonly targetPresentation: SceneRuntimePanelTargetAdapter
  readonly mapContributions: WorkspaceMapContributionAdapter
  readonly onMapStateChange?: (state: MapLibreCanvasSurfaceState) => void
  readonly onFailure?: (error: unknown) => void
  readonly readSnapshot?: (
    readInitialCenter: () => { readonly lat: number; readonly lon: number },
  ) => WorkspaceActivationSnapshot | null
  readonly readBackgroundPresentation?: () => ReturnType<typeof readWorkspaceBackgroundPresentation>
  /** Called once the camera has been still for `WORKSPACE_VIEW_SETTLE_MS` on a Design. */
  readonly onViewSettled?: (view: WorkspaceSettledView) => void
}

interface WorkspaceCompositionRuntime extends WorkspaceActivationRuntime {
  readonly commandSurface: CanvasCommandSurface
  readonly querySurface: CanvasQuerySurface
  readonly documentSurface: CanvasDocumentSurface
}

interface WorkspaceCompositionLifecycle extends WorkspaceGenerationLifecycle {
  updateBackgroundPresentation(presentation: MapBackgroundPresentation): void
  updateMapContributions(snapshot: WorkspaceMapContributionSnapshot | null): void
}

/** Constructor-only test seam. Production callers use the default cohesive assembly. */
interface WorkspaceRuntimeCompositionDependencies {
  readonly createRendererComposition: () => SharedMapSceneRendererComposition
  readonly createCamera: () => MapLibreWorkspaceCameraOwner
  readonly createRuntime: (options: SceneCanvasRuntimeOptions) => WorkspaceCompositionRuntime
  readonly createControls: (options: ConstructorParameters<typeof WorkspaceMapControls>[0]) => WorkspaceActivationMapControls
  readonly createWorkspace: (options: WorkspaceActivationOptions) => WorkspaceCompositionLifecycle
  readonly installEffect: (callback: () => void) => () => void
}

const DEFAULT_DEPENDENCIES: WorkspaceRuntimeCompositionDependencies = {
  createRendererComposition: createSharedMapSceneRendererComposition,
  createCamera: () => new MapLibreWorkspaceCameraOwner(),
  createRuntime: (options) => new SceneCanvasRuntime(options),
  createControls: (options) => new WorkspaceMapControls(options),
  createWorkspace: (options) => new WorkspaceActivationCoordinator(options),
  installEffect: effect,
}

/** App-owned composition for the production shared MapLibre runtime. */
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
  const controls = dependencies.createControls({
    container: options.container,
    contributions: {
      loadTerrainSupport: options.mapContributions.loadTerrainSupport,
      createRasterDisplay: options.mapContributions.createRasterDisplay,
      publishViewBounds: options.mapContributions.publishViewBounds,
      onStateChange: options.onMapStateChange,
    },
  })
  // Read without subscribing: the camera and scene layer call this per frame.
  const readOrigin = () => {
    const plane = runtime.querySurface.sessionPlane.peek()
    return plane
      ? { lat: plane.origin.lat, lon: plane.origin.lon }
      : { lat: DEFAULT_NEW_DESIGN_VIEW.lat, lon: DEFAULT_NEW_DESIGN_VIEW.lon }
  }
  const workspace = dependencies.createWorkspace({
    container: options.container,
    runtime,
    camera,
    composition: rendererComposition,
    map: controls,
    layer: {},
    readOrigin,
  })
  const reconciler = new WorkspaceGenerationReconciler({
    workspace,
    readSnapshot: () => options.readSnapshot
      ? options.readSnapshot(readOrigin)
      : readWorkspaceActivationSnapshot({ readInitialCenter: readOrigin }),
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
  let disposeOriginEffect: (() => void) | null = null
  let disposeSettleEffect: (() => void) | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  const clearSettleTimer = () => {
    if (settleTimer !== null) clearTimeout(settleTimer)
    settleTimer = null
  }
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
        // A new session plane (hydration or re-origin) keeps the map where it
        // is and republishes the plane viewport derived from it.
        disposeOriginEffect = dependencies.installEffect(() => {
          if (runtime.querySurface.sessionPlane.value) camera.attachment.refreshOrigin()
        })
        if (options.onViewSettled) {
          const onViewSettled = options.onViewSettled
          disposeSettleEffect = dependencies.installEffect(() => {
            const frame = runtime.querySurface.viewport.value
            const plane = runtime.querySurface.sessionPlane.value
            clearSettleTimer()
            if (!plane) return
            settleTimer = setTimeout(() => {
              settleTimer = null
              const view = settledViewOf(frame, plane)
              if (view) onViewSettled(view)
            }, WORKSPACE_VIEW_SETTLE_MS)
          })
        }
        disposePresentationEffect = dependencies.installEffect(() => {
          workspace.updateMapContributions(options.mapContributions.read(runtime.querySurface))
          workspace.updateBackgroundPresentation(
            (options.readBackgroundPresentation ?? readWorkspaceBackgroundPresentation)(),
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
      const originEffect = disposeOriginEffect
      const settleEffect = disposeSettleEffect
      disposePresentationEffect = null
      disposeOriginEffect = null
      disposeSettleEffect = null
      clearSettleTimer()
      void (async () => {
        const errors: unknown[] = []
        for (const disposeEffect of [settleEffect, originEffect, presentationEffect]) {
          try {
            disposeEffect?.()
          } catch (error) {
            errors.push(error)
          }
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

function settledViewOf(frame: CameraViewportSnapshot, plane: SessionPlane): WorkspaceSettledView | null {
  const centre = plane.toGeo(viewportCenterWorld(frame.viewport, frame.screenSize))
  const zoom = stageScaleToMapZoom(frame.viewport.scale, centre.lat)
  return [centre.lon, centre.lat, zoom].every(Number.isFinite)
    ? { lon: centre.lon, lat: centre.lat, zoom }
    : null
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
