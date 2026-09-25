import { signal, type Signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { createDetachedCanvasRuntimeAppAdapter } from '../../canvas/runtime/app-adapter'
import { CanvasRuntimeCleanupError } from '../../canvas/runtime/cleanup'
import { MAPLIBRE_SCENE_RENDERER_ID } from '../../canvas/runtime/renderers/maplibre-scene'
import { createDetachedSceneRuntimePanelTargetAdapter } from '../../canvas/runtime/scene-runtime/panel-target-adapter'
import type { SceneCanvasRuntimeOptions } from '../../canvas/runtime/scene-runtime'
import {
  createCanvasDocumentReplacementToken,
  type CanvasDocumentSurface,
} from '../../canvas/runtime/runtime'
import { MapLibreWorkspaceCameraOwner } from '../../maplibre/workspace-camera'
import type { WorkspaceMapContributionSnapshot, WorkspaceMapContributionAdapter } from './workspace-map-contribution-adapter'
import type { WorkspaceBasemapPresentation } from '../../maplibre/workspace-map'
import type { SharedMapSceneRendererComposition } from '../../maplibre/shared-scene-renderer'
import {
  createTestCanvasDocumentSurface,
  createTestCanvasRuntimeSurfaces,
} from '../../__tests__/support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from '../../__tests__/support/canvas-query-surface'
import { createSessionPlane, type SessionPlane } from '../../canvas/session-plane'
import type { CameraViewportSnapshot } from '../../canvas/runtime/camera'
import { stageScaleToMapZoom } from '../../canvas/projection'
import type {
  WorkspaceActivationOptions,
  WorkspaceActivationOutcome,
  WorkspaceActivationSnapshot,
} from './workspace-activation'
import type { WorkspaceGenerationLifecycle } from './workspace-generation-reconciler'
import {
  createWorkspaceRuntimeComposition,
  WORKSPACE_VIEW_SETTLE_MS,
  type WorkspaceSettledView,
} from './workspace-runtime-composition'

describe('createWorkspaceRuntimeComposition', () => {
  it('assembles one camera and ordered shared/fallback backends before awaiting existing-Design readiness', async () => {
    const activation = deferred<WorkspaceActivationOutcome>()
    const snapshot = workspaceSnapshot()
    const fixture = compositionFixture({
      readSnapshot: () => snapshot,
      activate: () => activation.promise,
    })

    const start = fixture.composition.start()

    expect(fixture.createRuntime).toHaveBeenCalledOnce()
    const runtimeOptions = fixture.createRuntime.mock.calls[0]![0]
    expect(runtimeOptions.camera).toBe(fixture.camera)
    expect(runtimeOptions.renderer?.backends.map((backend) => backend.id))
      .toEqual([MAPLIBRE_SCENE_RENDERER_ID, 'canvas2d'])
    const workspaceOptions = fixture.createWorkspace.mock.calls[0]![0]
    expect(workspaceOptions.runtime).toBe(fixture.runtime)
    expect(workspaceOptions.camera).toBe(fixture.camera)
    expect(workspaceOptions.composition).toBe(fixture.rendererComposition)
    expect(workspaceOptions.map).toBe(fixture.controls)
    expect(fixture.workspace.activate).toHaveBeenCalledExactlyOnceWith(snapshot)

    let settled = false
    void start.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    activation.resolve('shared-ready')
    await expect(start).resolves.toBe('shared-ready')
    expect(fixture.documents.initializeViewport).toHaveBeenCalledOnce()
    expect(fixture.documents.zoomToFit).not.toHaveBeenCalled()
  })

  it('starts empty without disconnecting or admitting map/runtime work', async () => {
    const fixture = compositionFixture({ readSnapshot: () => null })

    await expect(fixture.composition.start()).resolves.toBe('no-design')

    expect(fixture.workspace.requestGenerationDisconnect).not.toHaveBeenCalled()
    expect(fixture.workspace.activate).not.toHaveBeenCalled()
    expect(fixture.runtime.init).not.toHaveBeenCalled()
  })

  it.each<WorkspaceActivationOutcome>(['shared-ready', 'fallback-ready'])(
    'initializes and fits hydrated content once for %s',
    async (outcome) => {
      const fixture = compositionFixture({
        readSnapshot: () => workspaceSnapshot(),
        activate: async () => outcome,
        initiallyLoaded: true,
      })

      await expect(fixture.composition.start()).resolves.toBe(outcome)

      expect(fixture.documents.initializeViewport).toHaveBeenCalledOnce()
      expect(fixture.documents.zoomToFit).toHaveBeenCalledOnce()
      expect(fixture.documents.initializeViewport.mock.invocationCallOrder[0])
        .toBeLessThan(fixture.documents.zoomToFit.mock.invocationCallOrder[0]!)
    },
  )

  it('initializes and fits the first replacement after an empty start', async () => {
    let snapshot: WorkspaceActivationSnapshot | null = null
    const next = workspaceSnapshot()
    const fixture = compositionFixture({
      readSnapshot: () => snapshot,
      replaceDocument: (_file, _token, finalizeReplacement) => {
        snapshot = next
        fixture.setLoaded(true)
        finalizeReplacement()
        return { callerFinalizerInvoked: true }
      },
    })
    await expect(fixture.composition.start()).resolves.toBe('no-design')

    replaceDocument(fixture.composition.surfaces.documents)

    await vi.waitFor(() => expect(fixture.workspace.activate).toHaveBeenCalledExactlyOnceWith(next))
    await vi.waitFor(() => expect(fixture.documents.zoomToFit).toHaveBeenCalledOnce())
    expect(fixture.documents.initializeViewport).toHaveBeenCalledOnce()
  })

  it('retries only the incomplete viewport phase after a first-ready callback fails', async () => {
    let snapshot: WorkspaceActivationSnapshot | null = null
    const onFailure = vi.fn()
    const zoomError = new Error('fit failed')
    const fixture = compositionFixture({
      readSnapshot: () => snapshot,
      onFailure,
      zoomToFit: vi.fn()
        .mockImplementationOnce(() => { throw zoomError })
        .mockImplementation(() => {}),
      replaceDocument: (_file, _token, finalizeReplacement) => {
        fixture.setLoaded(true)
        finalizeReplacement()
        return { callerFinalizerInvoked: true }
      },
    })
    await fixture.composition.start()

    snapshot = workspaceSnapshot({ latitude: 10 })
    replaceDocument(fixture.composition.surfaces.documents)
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledExactlyOnceWith(zoomError))

    snapshot = workspaceSnapshot({ latitude: 20 })
    replaceDocument(fixture.composition.surfaces.documents)
    await vi.waitFor(() => expect(fixture.documents.zoomToFit).toHaveBeenCalledTimes(2))
    expect(fixture.documents.initializeViewport).toHaveBeenCalledOnce()
  })

  it('cancels initial readiness and retries viewport initialization on a later generation', async () => {
    let snapshot = workspaceSnapshot({ latitude: 10 })
    const error = new Error('viewport initialization failed')
    const onFailure = vi.fn()
    const fixture = compositionFixture({
      readSnapshot: () => snapshot,
      onFailure,
      initializeViewport: vi.fn()
        .mockImplementationOnce(() => { throw error })
        .mockImplementation(() => {}),
    })

    await expect(fixture.composition.start()).resolves.toBe('cancelled')
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(error)

    snapshot = workspaceSnapshot({ latitude: 20 })
    replaceDocument(fixture.composition.surfaces.documents)
    await vi.waitFor(() => expect(fixture.documents.initializeViewport).toHaveBeenCalledTimes(2))
  })

  it('cancels initial readiness and retries only hydrated fit on a later generation', async () => {
    let snapshot = workspaceSnapshot({ latitude: 10 })
    const error = new Error('initial fit failed')
    const onFailure = vi.fn()
    const fixture = compositionFixture({
      readSnapshot: () => snapshot,
      onFailure,
      initiallyLoaded: true,
      zoomToFit: vi.fn()
        .mockImplementationOnce(() => { throw error })
        .mockImplementation(() => {}),
    })

    await expect(fixture.composition.start()).resolves.toBe('cancelled')
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(error)

    snapshot = workspaceSnapshot({ latitude: 20 })
    replaceDocument(fixture.composition.surfaces.documents)
    await vi.waitFor(() => expect(fixture.documents.zoomToFit).toHaveBeenCalledTimes(2))
    expect(fixture.documents.initializeViewport).toHaveBeenCalledOnce()
  })

  it('projects live basemap settings without recreating resources and stops after disposal', async () => {
    const presentation = signal<WorkspaceBasemapPresentation>({
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 1,
    })
    const fixture = compositionFixture({
      readSnapshot: () => workspaceSnapshot(),
      readBasemapPresentation: () => presentation.value,
    })
    await fixture.composition.start()
    fixture.workspace.updateBasemapPresentation.mockClear()

    presentation.value = {
      basemapStyle: 'satellite', basemapVisible: false, basemapOpacity: 0.25,
    }

    await vi.waitFor(() => expect(fixture.workspace.updateBasemapPresentation)
      .toHaveBeenCalledExactlyOnceWith(presentation.value))
    expect(fixture.createRuntime).toHaveBeenCalledOnce()
    expect(fixture.createWorkspace).toHaveBeenCalledOnce()
    expect(fixture.workspace.activate).toHaveBeenCalledOnce()

    await fixture.composition.dispose()
    presentation.value = {
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 0.5,
    }
    await Promise.resolve()
    expect(fixture.workspace.updateBasemapPresentation).toHaveBeenCalledOnce()
  })

  it('forwards reactive contribution snapshots through the lifecycle and disposes the reader effect', async () => {
    const contribution = signal<WorkspaceMapContributionSnapshot | null>(null)
    const read = vi.fn<WorkspaceMapContributionAdapter['read']>(() => contribution.value)
    const initial = workspaceSnapshot()
    const fixture = compositionFixture({ readSnapshot: () => initial, mapContributions: { read } })
    await fixture.composition.start()
    expect(read.mock.calls[0]?.[0]).toBe(fixture.runtime.querySurface)
    const next: WorkspaceMapContributionSnapshot = {
      sessionIdentity: initial.sessionIdentity, lidar: [],
      terrain: { contourIntervalMeters: 1, contoursVisible: false, contoursOpacity: 1, hillshadeVisible: false, hillshadeOpacity: 1, isDark: false },
      overlays: { runtime: null, location: null, hoveredTargets: [], selectedTargets: [] },
      frame: null,
    }
    contribution.value = next
    await vi.waitFor(() => expect(fixture.workspace.updateMapContributions).toHaveBeenLastCalledWith(next))
    expect(fixture.workspace.activate).toHaveBeenCalledOnce()
    await fixture.composition.dispose()
    read.mockClear()
    contribution.value = null
    await Promise.resolve()
    expect(read).not.toHaveBeenCalled()
  })

  it('publishes memoized disposal before cleanup, joins teardown, and aggregates failures', async () => {
    const originEffectError = new Error('origin effect cleanup failed')
    const presentationEffectError = new Error('presentation effect cleanup failed')
    const effectErrors = [originEffectError, presentationEffectError]
    const teardownError = new Error('workspace teardown failed')
    let reentered: Promise<void> | null = null
    let fixture!: ReturnType<typeof compositionFixture>
    let installed = 0
    fixture = compositionFixture({
      readSnapshot: () => null,
      teardown: async () => { throw teardownError },
      installEffect: (callback) => {
        callback()
        const effectError = effectErrors[installed++]
        return () => {
          reentered = fixture.composition.dispose()
          throw effectError
        }
      },
    })
    await fixture.composition.start()

    const first = fixture.composition.dispose()
    const second = fixture.composition.dispose()

    expect(second).toBe(first)
    expect(reentered).toBe(first)
    expect(fixture.workspace.teardown).toHaveBeenCalledOnce()
    const error = await first.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(CanvasRuntimeCleanupError)
    expect(installed).toBe(2)
    expect((error as CanvasRuntimeCleanupError).errors)
      .toEqual([originEffectError, presentationEffectError, teardownError])
    await expect(fixture.composition.start()).resolves.toBe('cancelled')
  })

  it('reports one settled view after the camera stops moving and none after disposal', async () => {
    vi.useFakeTimers()
    try {
      const onViewSettled = vi.fn<(view: WorkspaceSettledView) => void>()
      const fixture = compositionFixture({ readSnapshot: () => null, onViewSettled })
      await expect(fixture.composition.start()).resolves.toBe('no-design')
      const plane = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
      fixture.sessionPlane.value = plane
      const viewport = fixture.runtime.querySurface.viewport as Signal<CameraViewportSnapshot>
      const moveTo = (x: number) => {
        viewport.value = {
          ...viewport.value,
          viewport: { x, y: 5, scale: 2 },
          revision: viewport.value.revision + 1,
        }
      }

      for (const x of [10, 20, 30]) {
        moveTo(x)
        vi.advanceTimersByTime(WORKSPACE_VIEW_SETTLE_MS - 1)
      }
      expect(onViewSettled).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)

      expect(onViewSettled).toHaveBeenCalledOnce()
      const { width, height } = viewport.value.screenSize
      const centre = plane.toGeo({ x: (width / 2 - 30) / 2, y: (height / 2 - 5) / 2 })
      const view = onViewSettled.mock.calls[0]![0]
      expect(view.lon).toBeCloseTo(centre.lon, 12)
      expect(view.lat).toBeCloseTo(centre.lat, 12)
      expect(view.zoom).toBeCloseTo(stageScaleToMapZoom(2, centre.lat), 12)
      vi.advanceTimersByTime(WORKSPACE_VIEW_SETTLE_MS * 4)
      expect(onViewSettled).toHaveBeenCalledOnce()

      // A pending settle is cancelled by disposal and later moves are ignored.
      moveTo(40)
      await fixture.composition.dispose()
      vi.advanceTimersByTime(WORKSPACE_VIEW_SETTLE_MS * 2)
      moveTo(50)
      vi.advanceTimersByTime(WORKSPACE_VIEW_SETTLE_MS * 2)
      expect(onViewSettled).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not start after terminal disposal before startup', async () => {
    const fixture = compositionFixture({ readSnapshot: () => null })

    await fixture.composition.dispose()

    await expect(fixture.composition.start()).resolves.toBe('cancelled')
    expect(fixture.workspace.activate).not.toHaveBeenCalled()
  })
})

interface CompositionFixtureOptions {
  readonly mapContributions?: WorkspaceMapContributionAdapter
  readonly readSnapshot: () => WorkspaceActivationSnapshot | null
  readonly readBasemapPresentation?: () => WorkspaceBasemapPresentation
  readonly onFailure?: (error: unknown) => void
  readonly activate?: (snapshot: WorkspaceActivationSnapshot) => Promise<WorkspaceActivationOutcome>
  readonly teardown?: () => Promise<void>
  readonly installEffect?: (callback: () => void) => () => void
  readonly initiallyLoaded?: boolean
  readonly replaceDocument?: CanvasDocumentSurface['replaceDocument']
  readonly initializeViewport?: () => void
  readonly zoomToFit?: () => void
  readonly onViewSettled?: (view: WorkspaceSettledView) => void
}

function compositionFixture(options: CompositionFixtureOptions) {
  let loaded = options.initiallyLoaded ?? false
  const documents = createTestCanvasDocumentSurface({
    initializeViewport: options.initializeViewport ?? vi.fn(),
    zoomToFit: options.zoomToFit ?? vi.fn(),
    hasLoadedDocument: () => loaded,
    ...(options.replaceDocument ? { replaceDocument: options.replaceDocument } : {}),
  })
  documents.initializeViewport = vi.fn(documents.initializeViewport)
  documents.zoomToFit = vi.fn(documents.zoomToFit)
  const sessionPlane = signal<SessionPlane | null>(null)
  const surfaces = createTestCanvasRuntimeSurfaces({
    documents,
    queries: { ...createTestCanvasQuerySurface(), sessionPlane },
  })
  const runtime = {
    commandSurface: surfaces.commands,
    querySurface: surfaces.queries,
    documentSurface: surfaces.documents,
    init: vi.fn(async () => {}),
    reportRendererFailure: vi.fn(async () => {}),
    destroy: vi.fn(),
  }
  const camera = new MapLibreWorkspaceCameraOwner()
  const rendererComposition = {
    renderer: {
      id: MAPLIBRE_SCENE_RENDERER_ID,
      initialize: vi.fn(),
    },
    createLayer: vi.fn(),
    failActiveLayer: vi.fn(),
  } as unknown as SharedMapSceneRendererComposition
  const controls = {
    createMap: vi.fn(),
    releaseMap: vi.fn(),
    getWebGL2Context: vi.fn(() => null),
    updateMapContributions: vi.fn(),
    updateBasemapPresentation: vi.fn(),
    installStyleRestorer: vi.fn(() => () => {}),
  }
  const workspace = {
    requestGenerationDisconnect: vi.fn(async () => {}),
    activate: vi.fn(options.activate ?? (async () => 'shared-ready' as const)),
    teardown: vi.fn(options.teardown ?? (async () => {})),
    updateMapContributions: vi.fn(),
    updateBasemapPresentation: vi.fn(),
  } satisfies WorkspaceGenerationLifecycle & {
    updateMapContributions(snapshot: WorkspaceMapContributionSnapshot | null): void
    updateBasemapPresentation(presentation: WorkspaceBasemapPresentation): void
  }
  const createRuntime = vi.fn((_options: SceneCanvasRuntimeOptions) => runtime)
  const createWorkspace = vi.fn((_input: WorkspaceActivationOptions) => workspace)
  const dependencies = {
    createRendererComposition: () => rendererComposition,
    createCamera: () => camera,
    createRuntime,
    createControls: () => controls,
    createWorkspace,
    ...(options.installEffect ? { installEffect: options.installEffect } : {}),
  }
  const composition = createWorkspaceRuntimeComposition({
    container: document.createElement('div'),
    appAdapter: createDetachedCanvasRuntimeAppAdapter(),
    targetPresentation: createDetachedSceneRuntimePanelTargetAdapter(),
    mapContributions: options.mapContributions ?? { read: () => null },
    onFailure: options.onFailure,
    readSnapshot: options.readSnapshot,
    readBasemapPresentation: options.readBasemapPresentation,
    onViewSettled: options.onViewSettled,
  }, dependencies)

  return {
    composition,
    controls,
    createRuntime,
    createWorkspace,
    camera,
    documents: documents as CanvasDocumentSurface & {
      initializeViewport: ReturnType<typeof vi.fn>
      zoomToFit: ReturnType<typeof vi.fn>
    },
    rendererComposition,
    runtime,
    sessionPlane,
    setLoaded(value: boolean) { loaded = value },
    workspace,
  }
}

function replaceDocument(documents: CanvasDocumentSurface): void {
  documents.replaceDocument(
    {} as never,
    createCanvasDocumentReplacementToken(),
    () => {},
  )
}

function workspaceSnapshot({ latitude = 48.86 } = {}): WorkspaceActivationSnapshot {
  return {
    sessionIdentity: {},
    map: {
      initialCenter: { lat: latitude, lon: 2.35 },
      basemapStyle: 'street',
      basemapVisible: true,
      basemapOpacity: 1,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
