import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { createDetachedCanvasRuntimeAppAdapter } from '../../canvas/runtime/app-adapter'
import { CanvasRuntimeCleanupError } from '../../canvas/runtime/cleanup'
import { MAPLIBRE_SCENE_RENDERER_ID } from '../../canvas/runtime/renderers/maplibre-scene'
import { createDetachedSceneRuntimePanelTargetAdapter } from '../../canvas/runtime/scene-runtime/panel-target-adapter'
import type { SceneCanvasRuntimeOptions } from '../../canvas/runtime/scene-runtime'
import type { CanvasDocumentSurface } from '../../canvas/runtime/runtime'
import type { WorkspaceMapContributionSnapshot, WorkspaceMapContributionAdapter } from './workspace-map-contribution-adapter'
import type { MapBackgroundPresentation } from '../../maplibre/map-background'
import type { SharedMapSceneRendererComposition } from '../../maplibre/shared-scene-renderer'
import {
  createTestCanvasDocumentSurface,
  createTestCanvasRuntimeSurfaces,
} from '../../__tests__/support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from '../../__tests__/support/canvas-query-surface'
import { createSessionPlane, geographicViewOfCamera } from '../../canvas/session-plane'
import { stageScaleToMapZoom } from '../../canvas/projection'
import { createViewReadSurface, SETTLE_MS } from '../../canvas/runtime/view/frame-source'
import { createTestView } from '../../__tests__/support/test-view'
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
  it('assembles one camera and the one MapLibre renderer before awaiting existing-Design readiness', async () => {
    const activation = deferred<WorkspaceActivationOutcome>()
    const snapshot = workspaceSnapshot()
    const fixture = compositionFixture({
      readSnapshot: () => snapshot,
      activate: () => activation.promise,
    })

    const start = fixture.composition.start()

    expect(fixture.createRuntime).toHaveBeenCalledOnce()
    const runtimeOptions = fixture.createRuntime.mock.calls[0]![0]
    // Renderer selection has one outcome: the composition's MapLibre renderer.
    expect(runtimeOptions.renderer).toBe(fixture.rendererComposition.renderer)
    expect(runtimeOptions.renderer?.id).toBe(MAPLIBRE_SCENE_RENDERER_ID)
    const workspaceOptions = fixture.createWorkspace.mock.calls[0]![0]
    expect(workspaceOptions.runtime).toBe(fixture.runtime)
    // The one camera is the runtime's.
    expect(workspaceOptions.camera).toBe(fixture.runtime.cameraHost)
    expect(workspaceOptions.composition).toBe(fixture.rendererComposition)
    expect(workspaceOptions.map).toBe(fixture.controls)
    expect(fixture.workspace.activate).toHaveBeenCalledExactlyOnceWith(snapshot)

    let settled = false
    void start.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    activation.resolve('shared-ready')
    await expect(start).resolves.toBe('shared-ready')
    // runtime.init frames the Design: the composition runs no viewport pass of its own.
    expect(fixture.documents.zoomToFit).not.toHaveBeenCalled()
  })

  it('starts empty without disconnecting or admitting map/runtime work', async () => {
    const fixture = compositionFixture({ readSnapshot: () => null })

    await expect(fixture.composition.start()).resolves.toBe('no-design')

    expect(fixture.workspace.requestGenerationDisconnect).not.toHaveBeenCalled()
    expect(fixture.workspace.activate).not.toHaveBeenCalled()
    expect(fixture.runtime.init).not.toHaveBeenCalled()
  })

  it('projects live background settings without recreating resources and stops after disposal', async () => {
    const presentation = signal<MapBackgroundPresentation>({
      basemap: { style: 'liberty', visible: true, opacity: 1 },
      satellite: { visible: false, opacity: 1 },
      locale: 'en',
    })
    const fixture = compositionFixture({
      readSnapshot: () => workspaceSnapshot(),
      readBackgroundPresentation: () => presentation.value,
    })
    await fixture.composition.start()
    fixture.workspace.updateBackgroundPresentation.mockClear()

    presentation.value = {
      basemap: { style: 'dark', visible: true, opacity: 0.25 },
      satellite: { visible: true, opacity: 0.8 },
      locale: 'fr',
    }

    await vi.waitFor(() => expect(fixture.workspace.updateBackgroundPresentation)
      .toHaveBeenCalledExactlyOnceWith(presentation.value))
    expect(fixture.createRuntime).toHaveBeenCalledOnce()
    expect(fixture.createWorkspace).toHaveBeenCalledOnce()
    expect(fixture.workspace.activate).toHaveBeenCalledOnce()

    await fixture.composition.dispose()
    presentation.value = {
      basemap: { style: 'liberty', visible: true, opacity: 0.5 },
      satellite: { visible: false, opacity: 1 },
      locale: 'en',
    }
    await Promise.resolve()
    expect(fixture.workspace.updateBackgroundPresentation).toHaveBeenCalledOnce()
  })

  it('folds the map credits as the visible map area asks, until disposal', async () => {
    const folded = signal(false)
    const fixture = compositionFixture({
      readSnapshot: () => workspaceSnapshot(),
      readAttributionCompact: () => folded.value,
    })
    await fixture.composition.start()
    expect(fixture.controls.setAttributionCompact).toHaveBeenLastCalledWith(false)
    folded.value = true
    expect(fixture.controls.setAttributionCompact).toHaveBeenLastCalledWith(true)
    await fixture.composition.dispose()
    fixture.controls.setAttributionCompact.mockClear()
    folded.value = false
    expect(fixture.controls.setAttributionCompact).not.toHaveBeenCalled()
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
      overlays: { runtime: null, location: null, hoveredTargets: [], selectedTargets: [], paintRevision: 0 },
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
    const presentationEffectError = new Error('presentation effect cleanup failed')
    const effectErrors = [presentationEffectError]
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
    expect(installed).toBe(1)
    expect((error as CanvasRuntimeCleanupError).errors)
      .toEqual([presentationEffectError, teardownError])
    await expect(fixture.composition.start()).resolves.toBe('cancelled')
  })

  it('the last view writes the settled camera once, one debounce after it settles', async () => {
    vi.useFakeTimers()
    try {
      const onViewSettled = vi.fn<(view: WorkspaceSettledView) => void>()
      const fixture = compositionFixture({ readSnapshot: () => null, onViewSettled })
      await expect(fixture.composition.start()).resolves.toBe('no-design')
      fixture.setLoaded(true)
      fixture.sessionPlane.value = SETTLE_PLANE

      fixture.view.setViewport({ x: 30, y: 5, scale: 2 })
      vi.advanceTimersByTime(SETTLE_MS)
      const settled = fixture.view.frames.settledViewFrame.peek().view.camera
      // A frame that leaves the camera where it is (an inset change) does not restart the debounce.
      vi.advanceTimersByTime(WORKSPACE_VIEW_SETTLE_MS - 100)
      fixture.view.navigation.setFramingInsets({ top: 40, right: 0, bottom: 0, left: 0 })
      vi.advanceTimersByTime(99)
      expect(onViewSettled).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)

      expect(onViewSettled).toHaveBeenCalledExactlyOnceWith(geographicViewOfCamera(settled))
      vi.advanceTimersByTime(WORKSPACE_VIEW_SETTLE_MS * 4)
      expect(onViewSettled).toHaveBeenCalledOnce()
      await fixture.composition.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the last view carries the settled bearing', async () => {
    vi.useFakeTimers()
    try {
      const onViewSettled = vi.fn<(view: WorkspaceSettledView) => void>()
      const fixture = compositionFixture({ readSnapshot: () => null, onViewSettled })
      await expect(fixture.composition.start()).resolves.toBe('no-design')
      fixture.setLoaded(true)
      fixture.sessionPlane.value = SETTLE_PLANE

      fixture.view.navigation.showCamera({ ...fixture.view.view().camera, bearingDeg: 30 }, { motion: 'jump' })
      vi.advanceTimersByTime(SETTLE_MS + WORKSPACE_VIEW_SETTLE_MS)

      expect(onViewSettled).toHaveBeenCalledOnce()
      expect(onViewSettled.mock.calls[0]![0].bearing).toBeCloseTo(30, 6)
      await fixture.composition.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports one settled view after the camera stops moving and none after disposal', async () => {
    vi.useFakeTimers()
    try {
      const onViewSettled = vi.fn<(view: WorkspaceSettledView) => void>()
      const fixture = compositionFixture({ readSnapshot: () => null, onViewSettled })
      await expect(fixture.composition.start()).resolves.toBe('no-design')
      fixture.setLoaded(true)
      fixture.sessionPlane.value = SETTLE_PLANE
      const moveTo = (x: number) => fixture.view.setViewport({ x, y: 5, scale: 2 })
      // The last view is written one debounce after the frame settles: 750 ms after the last move.
      const lastViewDelay = SETTLE_MS + WORKSPACE_VIEW_SETTLE_MS

      // Each move settles, and its settled camera restarts the debounce before it ran out.
      for (const x of [10, 20, 30]) {
        moveTo(x)
        vi.advanceTimersByTime(WORKSPACE_VIEW_SETTLE_MS - 1)
      }
      vi.advanceTimersByTime(lastViewDelay - WORKSPACE_VIEW_SETTLE_MS)
      expect(onViewSettled).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)

      expect(onViewSettled).toHaveBeenCalledOnce()
      const { width, height } = fixture.view.view().screen
      const centre = SETTLE_PLANE.toGeo({ x: (width / 2 - 30) / 2, y: (height / 2 - 5) / 2 })
      const view = onViewSettled.mock.calls[0]![0]
      expect(view.lon).toBeCloseTo(centre.lon, 6)
      expect(view.lat).toBeCloseTo(centre.lat, 6)
      expect(view.zoom).toBeCloseTo(stageScaleToMapZoom(2, SETTLE_PLANE.origin.lat), 6)
      vi.advanceTimersByTime(lastViewDelay * 4)
      expect(onViewSettled).toHaveBeenCalledOnce()

      // A pending settle is cancelled by disposal and later moves are ignored.
      moveTo(40)
      await fixture.composition.dispose()
      vi.advanceTimersByTime(lastViewDelay * 2)
      moveTo(50)
      vi.advanceTimersByTime(lastViewDelay * 2)
      expect(onViewSettled).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never reports a settled view before a Design is loaded', async () => {
    vi.useFakeTimers()
    try {
      const onViewSettled = vi.fn<(view: WorkspaceSettledView) => void>()
      const fixture = compositionFixture({ readSnapshot: () => null, onViewSettled })
      await expect(fixture.composition.start()).resolves.toBe('no-design')
      const lastViewDelay = SETTLE_MS + WORKSPACE_VIEW_SETTLE_MS
      // The map settles on the camera's default viewport before the Design
      // arrives; that view is not the user's and must not become the last view.
      fixture.sessionPlane.value = SETTLE_PLANE
      fixture.view.setViewport({ x: 1, y: 0, scale: 1 })
      vi.advanceTimersByTime(lastViewDelay * 2)
      expect(onViewSettled).not.toHaveBeenCalled()

      fixture.setLoaded(true)
      fixture.view.setViewport({ x: 5, y: 5, scale: 2 })
      vi.advanceTimersByTime(lastViewDelay)
      expect(onViewSettled).toHaveBeenCalledOnce()
      await fixture.composition.dispose()
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

/** The Scene's plane the settle tests' camera and Design share. */
const SETTLE_PLANE = createSessionPlane({ lon: 2.3522, lat: 48.8566 })

interface CompositionFixtureOptions {
  readonly mapContributions?: WorkspaceMapContributionAdapter
  readonly readSnapshot: () => WorkspaceActivationSnapshot | null
  readonly readBackgroundPresentation?: () => MapBackgroundPresentation
  readonly readAttributionCompact?: () => boolean
  readonly onFailure?: (error: unknown) => void
  readonly activate?: (snapshot: WorkspaceActivationSnapshot) => Promise<WorkspaceActivationOutcome>
  readonly teardown?: () => Promise<void>
  readonly installEffect?: (callback: () => void) => () => void
  readonly initiallyLoaded?: boolean
  readonly zoomToFit?: () => void
  readonly onViewSettled?: (view: WorkspaceSettledView) => void
}

function compositionFixture(options: CompositionFixtureOptions) {
  let loaded = options.initiallyLoaded ?? false
  const documents = createTestCanvasDocumentSurface({
    zoomToFit: options.zoomToFit ?? vi.fn(),
    hasLoadedDocument: () => loaded,
  })
  documents.zoomToFit = vi.fn(documents.zoomToFit)
  // The runtime's camera: the query surface's view reads its frames on the Scene's plane.
  const view = createTestView({ plane: SETTLE_PLANE })
  const queries = createTestCanvasQuerySurface({ sessionPlane: null })
  const sessionPlane = queries.sessionPlane
  const surfaces = createTestCanvasRuntimeSurfaces({
    documents,
    queries: { ...queries, view: createViewReadSurface(view.frames) },
  })
  const runtime = {
    cameraHost: view.host,
    commandSurface: surfaces.commands,
    querySurface: surfaces.queries,
    documentSurface: surfaces.documents,
    init: vi.fn(async () => {}),
    unmountRenderer: vi.fn(async () => {}),
    destroy: vi.fn(),
  }
  const rendererComposition = {
    renderer: {
      id: MAPLIBRE_SCENE_RENDERER_ID,
      initialize: vi.fn(),
    },
    createLayer: vi.fn(),
  } as unknown as SharedMapSceneRendererComposition
  const controls = {
    createMap: vi.fn(),
    releaseMap: vi.fn(),
    getWebGL2Context: vi.fn(() => null),
    updateMapContributions: vi.fn(),
    updateBackgroundPresentation: vi.fn(),
    setAttributionCompact: vi.fn(),
    installStyleRestorer: vi.fn(() => () => {}),
  }
  const workspace = {
    requestGenerationDisconnect: vi.fn(async () => {}),
    activate: vi.fn(options.activate ?? (async () => 'shared-ready' as const)),
    teardown: vi.fn(options.teardown ?? (async () => {})),
    updateMapContributions: vi.fn(),
    updateBackgroundPresentation: vi.fn(),
  } satisfies WorkspaceGenerationLifecycle & {
    updateMapContributions(snapshot: WorkspaceMapContributionSnapshot | null): void
    updateBackgroundPresentation(presentation: MapBackgroundPresentation): void
  }
  const createRuntime = vi.fn((_options: SceneCanvasRuntimeOptions) => runtime)
  const createWorkspace = vi.fn((_input: WorkspaceActivationOptions) => workspace)
  const dependencies = {
    createRendererComposition: () => rendererComposition,
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
    readBackgroundPresentation: options.readBackgroundPresentation,
    readAttributionCompact: options.readAttributionCompact ?? (() => false),
    onViewSettled: options.onViewSettled,
  }, dependencies)

  return {
    composition,
    controls,
    createRuntime,
    createWorkspace,
    documents: documents as CanvasDocumentSurface & {
      zoomToFit: ReturnType<typeof vi.fn>
    },
    rendererComposition,
    runtime,
    sessionPlane,
    setLoaded(value: boolean) { loaded = value },
    view,
    workspace,
  }
}

function workspaceSnapshot({ latitude = 48.86 } = {}): WorkspaceActivationSnapshot {
  return {
    sessionIdentity: {},
    map: {
      initialCenter: { lat: latitude, lon: 2.35 },
      background: {
        basemap: { style: 'liberty', visible: true, opacity: 1 },
        satellite: { visible: false, opacity: 1 },
        locale: 'en',
      },
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
