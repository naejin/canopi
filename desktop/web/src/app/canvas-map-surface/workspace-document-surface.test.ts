import { describe, expect, it, vi } from 'vitest'
import { createCanvasDocumentReplacementToken, type CanvasDocumentSurface } from '../../canvas/runtime/runtime'
import { createTestCanvasDocumentSurface } from '../../__tests__/support/canvas-runtime-surfaces'
import { MapLibreWorkspaceCameraOwner } from '../../maplibre/workspace-camera'
import type { WorkspaceMapSnapshot } from '../../maplibre/workspace-map'
import {
  WorkspaceActivationCoordinator,
  type WorkspaceActivationMap,
} from './workspace-activation'
import { createWorkspaceDocumentSurface } from './workspace-document-surface'
import { WorkspaceGenerationReconciler } from './workspace-generation-reconciler'

describe('createWorkspaceDocumentSurface', () => {
  it('requests the workspace fence before synchronously delegating replacement', () => {
    const events: string[] = []
    const workspace = {
      requestGenerationDisconnect: vi.fn(() => {
        events.push('generation-fenced')
        events.push('acquisition-aborted')
        events.push('callbacks-fenced')
        events.push('camera-detached')
        events.push('layer-dispose-started')
        return Promise.resolve()
      }),
      activate: vi.fn(async () => 'cancelled' as const),
      teardown: vi.fn(async () => {}),
    }
    const documents = createTestCanvasDocumentSurface({
      replaceDocument: (_file, _token, finalizeReplacement) => {
        events.push('replace')
        finalizeReplacement()
        return { callerFinalizerInvoked: true }
      },
    })
    const surface = createWorkspaceDocumentSurface({
      documents,
      reconciler: new WorkspaceGenerationReconciler({
        workspace,
        readSnapshot: () => ({ sessionIdentity: {}, map: mapSnapshot() }),
      }),
    })

    surface.replaceDocument({} as never, createCanvasDocumentReplacementToken(), () => {
      events.push('finalize')
    })

    expect(events).toEqual([
      'generation-fenced',
      'acquisition-aborted',
      'callbacks-fenced',
      'camera-detached',
      'layer-dispose-started',
      'replace',
      'finalize',
    ])
  })

  it('delegates non-replacement document roles without disconnecting', () => {
    const workspace = createWorkspaceLifecycle()
    const documents = createDocumentSurfaceSpy()
    const surface = createWorkspaceDocumentSurface({
      documents,
      reconciler: createReconciler(workspace),
    })
    const element = document.createElement('div')

    surface.attachInspectionTo(element)
    surface.initializeViewport()
    surface.attachRulersTo(element)
    surface.showCanvasChrome()
    surface.hideCanvasChrome()
    surface.zoomToFit()
    surface.loadDocument({} as never)
    surface.hasLoadedDocument()
    surface.captureForPersistence({ name: 'Design' }, {} as never)
    surface.resize(100, 200)
    surface.destroy()

    expect(workspace.requestGenerationDisconnect).not.toHaveBeenCalled()
    expect(documents.attachInspectionTo).toHaveBeenCalledWith(element)
    expect(documents.initializeViewport).toHaveBeenCalledOnce()
    expect(documents.attachRulersTo).toHaveBeenCalledWith(element)
    expect(documents.showCanvasChrome).toHaveBeenCalledOnce()
    expect(documents.hideCanvasChrome).toHaveBeenCalledOnce()
    expect(documents.zoomToFit).toHaveBeenCalledOnce()
    expect(documents.loadDocument).toHaveBeenCalledOnce()
    expect(documents.hasLoadedDocument).toHaveBeenCalledOnce()
    expect(documents.captureForPersistence).toHaveBeenCalledOnce()
    expect(documents.resize).toHaveBeenCalledWith(100, 200)
    expect(documents.destroy).toHaveBeenCalledOnce()
  })

  it('preserves the underlying document receiver for delegated role methods', () => {
    const workspace = createWorkspaceLifecycle()
    const documents = createDocumentSurfaceSpy()
    const loadDocument = vi.fn(function (this: CanvasDocumentSurface) {
      expect(this).toBe(documents)
    })
    documents.loadDocument = loadDocument
    const surface = createWorkspaceDocumentSurface({
      documents,
      reconciler: createReconciler(workspace),
    })

    surface.loadDocument({} as never)

    expect(loadDocument).toHaveBeenCalledOnce()
    expect(workspace.requestGenerationDisconnect).not.toHaveBeenCalled()
  })

  it('aborts pending map acquisition before the delegated replacement runs', async () => {
    const created = deferred<WorkspaceActivationMap>()
    let signal: AbortSignal | null = null
    const releaseMap = vi.fn()
    const camera = new MapLibreWorkspaceCameraOwner()
    camera.initialize({ width: 400, height: 300 })
    const workspace = new WorkspaceActivationCoordinator({
      container: document.createElement('div'),
      runtime: {
        init: async () => {},
        unmountRenderer: async () => {},
        destroy: () => {},
      },
      camera,
      composition: {
        renderer: {} as never,
        createLayer: vi.fn(),
      },
      map: {
        createMap: (candidateSignal) => {
          signal = candidateSignal
          return created.promise
        },
        releaseMap,
        getWebGL2Context: () => null,
        updateMapContributions: () => {},
        updateBackgroundPresentation: () => {},
        installStyleRestorer: () => () => {},
      },
      layer: {},
      readOrigin: () => ({ lat: 0, lon: 0 }),
    })
    const activation = workspace.activate({
      sessionIdentity: {},
      map: {
        initialCenter: { lat: 0, lon: 0 },
        background: {
          basemap: { style: 'liberty', visible: true, opacity: 1 },
          satellite: { visible: false, opacity: 1 },
          locale: 'en',
        },
      },
    })
    await vi.waitFor(() => expect(signal).not.toBeNull())
    const documents = createTestCanvasDocumentSurface({
      replaceDocument: (_file, _token, finalizeReplacement) => {
        expect(signal?.aborted).toBe(true)
        finalizeReplacement()
        return { callerFinalizerInvoked: true }
      },
    })
    const surface = createWorkspaceDocumentSurface({
      documents,
      reconciler: new WorkspaceGenerationReconciler({
        workspace,
        readSnapshot: () => ({ sessionIdentity: {}, map: mapSnapshot() }),
      }),
    })

    surface.replaceDocument({} as never, createCanvasDocumentReplacementToken(), () => {})
    const staleMap = {} as WorkspaceActivationMap
    created.resolve(staleMap)

    await expect(activation).resolves.toBe('cancelled')
    expect(releaseMap).toHaveBeenCalledWith(staleMap)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createDocumentSurfaceSpy(): CanvasDocumentSurface {
  const surface = createTestCanvasDocumentSurface({
    attachInspectionTo: () => ({ dispose: () => {} }) as never,
  })
  return {
    ...surface,
    attachInspectionTo: vi.fn(surface.attachInspectionTo),
    initializeViewport: vi.fn(surface.initializeViewport),
    attachRulersTo: vi.fn(surface.attachRulersTo),
    showCanvasChrome: vi.fn(surface.showCanvasChrome),
    hideCanvasChrome: vi.fn(surface.hideCanvasChrome),
    zoomToFit: vi.fn(surface.zoomToFit),
    loadDocument: vi.fn(surface.loadDocument),
    hasLoadedDocument: vi.fn(surface.hasLoadedDocument),
    captureForPersistence: vi.fn(surface.captureForPersistence),
    resize: vi.fn(surface.resize),
    destroy: vi.fn(surface.destroy),
  }
}

function createWorkspaceLifecycle() {
  return {
    requestGenerationDisconnect: vi.fn(async () => {}),
    activate: vi.fn(async () => 'cancelled' as const),
    teardown: vi.fn(async () => {}),
  }
}

function createReconciler(workspace: ReturnType<typeof createWorkspaceLifecycle>) {
  return new WorkspaceGenerationReconciler({
    workspace,
    readSnapshot: () => ({ sessionIdentity: {}, map: mapSnapshot() }),
  })
}

function mapSnapshot(): WorkspaceMapSnapshot {
  return {
    initialCenter: { lat: 0, lon: 0 },
    background: {
      basemap: { style: 'liberty', visible: true, opacity: 1 },
      satellite: { visible: false, opacity: 1 },
      locale: 'en',
    },
  }
}
