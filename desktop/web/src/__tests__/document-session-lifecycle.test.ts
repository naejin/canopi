import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesignSessionLifecycle } from '../app/document-session/lifecycle'
import {
  createTestCanvasDocumentSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'
import type { CanvasRuntimeSurfaces } from '../canvas/runtime/runtime'
import {
  abortFailedAttachedDesignSessionStart,
  autosaveDesignSession,
  consumeQueuedDocumentLoad,
  startAttachedDesignSession,
  teardownAttachedDesignSession,
} from '../app/document-session/transition'
import { setCanvasRuntimeSurfaces } from '../canvas/session'
import { flushSettingsProjection } from '../app/settings/projection'
import type {
  WorkspaceRuntimeComposition,
  WorkspaceRuntimeStartOutcome,
} from '../app/canvas-map-surface/workspace-runtime-composition'

vi.mock('../app/document-session/transition', () => ({
  abortFailedAttachedDesignSessionStart: vi.fn(),
  autosaveDesignSession: vi.fn(async () => undefined),
  consumeQueuedDocumentLoad: vi.fn(() => () => {}),
  startAttachedDesignSession: vi.fn(async () => null),
  teardownAttachedDesignSession: vi.fn(),
}))

vi.mock('../app/settings/projection', () => ({
  flushSettingsProjection: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushLifecycle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function composition(
  surfaces: CanvasRuntimeSurfaces,
  start: () => Promise<WorkspaceRuntimeStartOutcome> = async () => 'shared-ready',
  dispose: () => Promise<void> = async () => undefined,
): WorkspaceRuntimeComposition {
  return {
    surfaces,
    start,
    dispose,
  }
}

describe('document session lifecycle', () => {
  let canvasArea: HTMLDivElement
  let container: HTMLDivElement
  let rulerOverlay: HTMLDivElement

  beforeEach(() => {
    setCanvasRuntimeSurfaces(null)
    vi.mocked(flushSettingsProjection).mockReset()
    vi.mocked(flushSettingsProjection).mockResolvedValue(undefined)
    vi.mocked(abortFailedAttachedDesignSessionStart).mockReset()
    vi.mocked(teardownAttachedDesignSession).mockReset()
    vi.mocked(startAttachedDesignSession).mockReset()
    vi.mocked(startAttachedDesignSession).mockResolvedValue(null)
    vi.mocked(consumeQueuedDocumentLoad).mockClear()
    vi.mocked(consumeQueuedDocumentLoad).mockImplementation(() => () => {})
    canvasArea = document.createElement('div')
    container = document.createElement('div')
    rulerOverlay = document.createElement('div')
  })

  it.each<WorkspaceRuntimeStartOutcome>(['shared-ready', 'map-unavailable', 'no-design'])(
    'publishes Canvas Runtime Surfaces after the workspace reports %s',
    async (outcome) => {
      const initializeViewport = vi.fn<() => void>()
      const attachRulersTo = vi.fn<(element: HTMLElement) => void>()
      const documents = createTestCanvasDocumentSurface({
        initializeViewport,
        attachRulersTo,
      })
      const surfaces = createTestCanvasRuntimeSurfaces({ documents })
      const start = vi.fn(async () => outcome)
      const dispose = vi.fn(async () => undefined)
      const createRuntimeComposition = vi.fn(() => composition(surfaces, start, dispose))
      const observe = vi.fn<(target: Element) => void>()
      const createResizeObserver = vi.fn(() => ({ observe, disconnect: vi.fn() }))
      const publishSurfaces = vi.fn<(surfaces: CanvasRuntimeSurfaces | null) => void>(
        setCanvasRuntimeSurfaces,
      )
      const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()

      const lifecycle = createDesignSessionLifecycle(
        { canvasArea, container, rulerOverlay },
        {
          createRuntimeComposition,
          publishSurfaces,
          createResizeObserver,
          readInitialAutosaveInterval: () => 1000,
          logError,
        },
      )

      lifecycle.start()
      await Promise.resolve()
      await Promise.resolve()
      await flushLifecycle()

      expect(createRuntimeComposition).toHaveBeenCalledWith(expect.objectContaining({
        container,
        onFailure: expect.any(Function),
      }))
      expect(start).toHaveBeenCalledOnce()
      expect(publishSurfaces).toHaveBeenCalled()
      expect(publishSurfaces.mock.calls[0]![0] === surfaces).toBe(true)
      expect(initializeViewport).not.toHaveBeenCalled()
      expect(attachRulersTo.mock.calls[0]?.[0] === rulerOverlay).toBe(true)
      expect(logError).not.toHaveBeenCalled()
      const startupOrder = [
        start.mock.invocationCallOrder[0]!,
        attachRulersTo.mock.invocationCallOrder[0]!,
        vi.mocked(startAttachedDesignSession).mock.invocationCallOrder[0]!,
        observe.mock.invocationCallOrder[0]!,
        vi.mocked(consumeQueuedDocumentLoad).mock.invocationCallOrder[0]!,
        publishSurfaces.mock.invocationCallOrder[0]!,
      ]
      expect(startupOrder).toEqual([...startupOrder].sort((left, right) => left - right))

      await lifecycle.dispose()

      expect(dispose).toHaveBeenCalledTimes(1)
      expect(publishSurfaces.mock.calls.at(-1)![0]).toBe(null)
    },
  )

  it('does not attach or publish when workspace start is cancelled', async () => {
    const attachRulersTo = vi.fn<(element: HTMLElement) => void>()
    const surfaces = createTestCanvasRuntimeSurfaces({
      documents: createTestCanvasDocumentSurface({ attachRulersTo }),
    })
    const publishSurfaces = vi.fn<(surfaces: CanvasRuntimeSurfaces | null) => void>()
    const onInitializationFailure = vi.fn<() => void>()
    const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()
    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeComposition: () => composition(surfaces, async () => 'cancelled'),
        publishSurfaces,
        createResizeObserver: () => null,
        readInitialAutosaveInterval: () => 1000,
        logError,
        onInitializationFailure,
      },
    )

    lifecycle.start()
    await flushLifecycle()

    expect(attachRulersTo).not.toHaveBeenCalled()
    expect(startAttachedDesignSession).not.toHaveBeenCalled()
    expect(publishSurfaces).not.toHaveBeenCalled()
    expect(onInitializationFailure).toHaveBeenCalledOnce()
    expect(logError).toHaveBeenCalledWith(
      'Failed to initialize scene canvas runtime:',
      expect.objectContaining({ message: 'Shared workspace initialization was cancelled.' }),
    )

    await lifecycle.dispose()
  })

  it('reports a fire-and-forget autosave rejection through its lifecycle logger', async () => {
    vi.useFakeTimers()
    const autosaveError = new Error('stale Canvas lease')
    vi.mocked(autosaveDesignSession).mockRejectedValueOnce(autosaveError)
    const surfaces = createTestCanvasRuntimeSurfaces()
    const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()
    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeComposition: () => composition(surfaces),
        publishSurfaces: vi.fn(),
        createResizeObserver: () => null,
        readInitialAutosaveInterval: () => 100,
        logError,
      },
    )

    try {
      lifecycle.start()
      await Promise.resolve()
      await Promise.resolve()
      await flushLifecycle()
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      await Promise.resolve()

      expect(logError).toHaveBeenCalledWith('Autosave failed:', autosaveError)
    } finally {
      lifecycle.dispose()
      vi.useRealTimers()
    }
  })

  it('hands off synchronously, then awaits settings and composition teardown before unpublishing', async () => {
    const settingsFlush = deferred<void>()
    const compositionDispose = deferred<void>()
    vi.mocked(flushSettingsProjection).mockReturnValueOnce(settingsFlush.promise)
    const documents = createTestCanvasDocumentSurface()
    const surfaces = createTestCanvasRuntimeSurfaces({ documents })
    const publishSurfaces = vi.fn<(surfaces: CanvasRuntimeSurfaces | null) => void>(
      setCanvasRuntimeSurfaces,
    )
    const dispose = vi.fn(() => compositionDispose.promise)
    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeComposition: () => composition(surfaces, undefined, dispose),
        publishSurfaces,
        createResizeObserver: () => null,
        readInitialAutosaveInterval: () => 1000,
        logError: vi.fn(),
      },
    )
    lifecycle.start()
    await Promise.resolve()
    await Promise.resolve()
    await flushLifecycle()

    const disposal = lifecycle.dispose()
    expect(teardownAttachedDesignSession).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
    expect(publishSurfaces.mock.calls.at(-1)?.[0]).toBe(surfaces)

    settingsFlush.resolve()
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledOnce()
    expect(publishSurfaces.mock.calls.at(-1)?.[0]).toBe(surfaces)

    compositionDispose.resolve()
    await disposal
    expect(publishSurfaces.mock.calls.at(-1)?.[0]).toBe(null)
  })

  it('releases terminal ownership when guarded surface unpublication throws', async () => {
    const unpublicationError = new Error('surface observer failed')
    const surfaces = createTestCanvasRuntimeSurfaces()
    const destroy = vi.fn(async () => undefined)
    const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()
    const publishSurfaces = vi.fn((next: CanvasRuntimeSurfaces | null) => {
      setCanvasRuntimeSurfaces(next)
      if (next === null) throw unpublicationError
    })
    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeComposition: () => ({
          surfaces,
          start: vi.fn(async () => 'shared-ready' as const),
          dispose: destroy,
        }),
        publishSurfaces,
        createResizeObserver: () => null,
        readInitialAutosaveInterval: () => 1000,
        logError,
      },
    )
    lifecycle.start()
    await Promise.resolve()
    await Promise.resolve()
    await flushLifecycle()

    await expect(lifecycle.dispose()).resolves.toBeUndefined()
    await expect(lifecycle.dispose()).resolves.toBeUndefined()

    expect(destroy).toHaveBeenCalledOnce()
    expect(logError).toHaveBeenCalledWith(
      'Failed to dispose Design Session lifecycle:',
      unpublicationError,
    )
  })

  it('requests owner cleanup when runtime initialization rejects asynchronously', async () => {
    const initializationError = new Error('renderer initialization failed')
    const onInitializationFailure = vi.fn<() => void>()
    const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()
    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeComposition: () => ({
          surfaces: createTestCanvasRuntimeSurfaces(),
          start: vi.fn(async () => {
            throw initializationError
          }),
          dispose: vi.fn(async () => undefined),
        }),
        publishSurfaces: vi.fn(),
        createResizeObserver: () => null,
        readInitialAutosaveInterval: () => 1000,
        logError,
        onInitializationFailure,
      },
    )

    try {
      lifecycle.start()
      await Promise.resolve()
      await Promise.resolve()
      await flushLifecycle()

      expect(logError).toHaveBeenCalledWith(
        'Failed to initialize scene canvas runtime:',
        initializationError,
      )
      expect(onInitializationFailure).toHaveBeenCalledOnce()
    } finally {
      lifecycle.dispose()
    }
  })

  it('aborts an unpublished failed mount before releasing its runtime owner', async () => {
    const mountError = new Error('late document hydration failed')
    vi.mocked(startAttachedDesignSession).mockResolvedValueOnce({
      status: 'failed',
      documentLoaded: true,
      error: mountError,
    })
    const documents = createTestCanvasDocumentSurface()
    const publishSurfaces = vi.fn<(surfaces: CanvasRuntimeSurfaces | null) => void>()
    const onInitializationFailure = vi.fn<() => void>()
    const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()
    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeComposition: () => ({
          surfaces: createTestCanvasRuntimeSurfaces({ documents }),
          start: vi.fn(async () => 'shared-ready' as const),
          dispose: vi.fn(async () => undefined),
        }),
        publishSurfaces,
        createResizeObserver: () => null,
        readInitialAutosaveInterval: () => 1000,
        logError,
        onInitializationFailure,
      },
    )

    try {
      lifecycle.start()
      await Promise.resolve()
      await Promise.resolve()
      await flushLifecycle()
      await Promise.resolve()
      await Promise.resolve()
      await flushLifecycle()

      expect(abortFailedAttachedDesignSessionStart).toHaveBeenCalledWith(
        documents,
        logError,
      )
      expect(publishSurfaces).not.toHaveBeenCalled()
      expect(onInitializationFailure).toHaveBeenCalledOnce()
      expect(logError).toHaveBeenCalledWith(
        'Failed to initialize scene canvas runtime:',
        mountError,
      )
    } finally {
      lifecycle.dispose()
    }
  })

  it('reports owner cleanup failure without leaking an unhandled rejection', async () => {
    const cleanupError = new Error('runtime lease release failed')
    const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()
    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeComposition: () => ({
          surfaces: createTestCanvasRuntimeSurfaces(),
          start: vi.fn(async () => {
            throw new Error('renderer initialization failed')
          }),
          dispose: vi.fn(async () => undefined),
        }),
        publishSurfaces: vi.fn(),
        createResizeObserver: () => null,
        readInitialAutosaveInterval: () => 1000,
        logError,
        onInitializationFailure: () => {
          throw cleanupError
        },
      },
    )

    try {
      lifecycle.start()
      await Promise.resolve()
      await Promise.resolve()
      await flushLifecycle()

      expect(logError).toHaveBeenCalledWith(
        'Failed to clean up after Canvas runtime initialization failure:',
        cleanupError,
      )
    } finally {
      lifecycle.dispose()
    }
  })
})
