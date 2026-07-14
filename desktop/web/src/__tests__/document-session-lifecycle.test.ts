import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesignSessionLifecycle } from '../app/document-session/lifecycle'
import {
  createTestCanvasDocumentSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'
import type { CanvasRuntimeHost, CanvasRuntimeSurfaces } from '../canvas/runtime/runtime'
import {
  abortFailedAttachedDesignSessionStart,
  autosaveDesignSession,
  startAttachedDesignSession,
} from '../app/document-session/transition'
import { setCanvasRuntimeSurfaces } from '../canvas/session'

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

describe('document session lifecycle', () => {
  let canvasArea: HTMLDivElement
  let container: HTMLDivElement
  let rulerOverlay: HTMLDivElement

  beforeEach(() => {
    setCanvasRuntimeSurfaces(null)
    vi.mocked(abortFailedAttachedDesignSessionStart).mockReset()
    vi.mocked(startAttachedDesignSession).mockReset()
    vi.mocked(startAttachedDesignSession).mockResolvedValue(null)
    canvasArea = document.createElement('div')
    container = document.createElement('div')
    rulerOverlay = document.createElement('div')
  })

  it('initializes and publishes Canvas Runtime Surfaces through a runtime host', async () => {
    const initializeViewport = vi.fn<() => void>()
    const attachRulersTo = vi.fn<(element: HTMLElement) => void>()
    const documents = createTestCanvasDocumentSurface({
      initializeViewport,
      attachRulersTo,
    })
    const surfaces = createTestCanvasRuntimeSurfaces({ documents })
    const init = vi.fn<(target: HTMLElement) => Promise<void>>(async () => undefined)
    const destroy = vi.fn<() => void>()
    const host: CanvasRuntimeHost = {
      surfaces,
      init,
      destroy,
    }
    const publishSurfaces = vi.fn<(surfaces: CanvasRuntimeSurfaces | null) => void>(
      setCanvasRuntimeSurfaces,
    )
    const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()

    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeHost: () => host,
        publishSurfaces,
        createResizeObserver: () => null,
        readInitialAutosaveInterval: () => 1000,
        logError,
      },
    )

    lifecycle.start()
    await Promise.resolve()
    await Promise.resolve()

    expect(init).toHaveBeenCalledOnce()
    expect(init.mock.calls[0]![0] === container).toBe(true)
    expect(publishSurfaces).toHaveBeenCalled()
    expect(publishSurfaces.mock.calls[0]![0] === surfaces).toBe(true)
    expect(initializeViewport).toHaveBeenCalledTimes(1)
    expect(attachRulersTo.mock.calls[0]?.[0] === rulerOverlay).toBe(true)
    expect(logError).not.toHaveBeenCalled()

    lifecycle.dispose()

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(publishSurfaces.mock.calls.at(-1)![0]).toBe(null)
  })

  it('reports a fire-and-forget autosave rejection through its lifecycle logger', async () => {
    vi.useFakeTimers()
    const autosaveError = new Error('stale Canvas lease')
    vi.mocked(autosaveDesignSession).mockRejectedValueOnce(autosaveError)
    const surfaces = createTestCanvasRuntimeSurfaces()
    const host: CanvasRuntimeHost = {
      surfaces,
      init: vi.fn(async () => undefined),
      destroy: vi.fn(),
    }
    const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()
    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeHost: () => host,
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
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      await Promise.resolve()

      expect(logError).toHaveBeenCalledWith('Autosave failed:', autosaveError)
    } finally {
      lifecycle.dispose()
      vi.useRealTimers()
    }
  })

  it('requests owner cleanup when runtime initialization rejects asynchronously', async () => {
    const initializationError = new Error('renderer initialization failed')
    const onInitializationFailure = vi.fn<() => void>()
    const logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()
    const lifecycle = createDesignSessionLifecycle(
      { canvasArea, container, rulerOverlay },
      {
        createRuntimeHost: () => ({
          surfaces: createTestCanvasRuntimeSurfaces(),
          init: vi.fn(async () => {
            throw initializationError
          }),
          destroy: vi.fn(),
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
        createRuntimeHost: () => ({
          surfaces: createTestCanvasRuntimeSurfaces({ documents }),
          init: vi.fn(async () => undefined),
          destroy: vi.fn(),
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
      await Promise.resolve()
      await Promise.resolve()

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
        createRuntimeHost: () => ({
          surfaces: createTestCanvasRuntimeSurfaces(),
          init: vi.fn(async () => {
            throw new Error('renderer initialization failed')
          }),
          destroy: vi.fn(),
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

      expect(logError).toHaveBeenCalledWith(
        'Failed to clean up after Canvas runtime initialization failure:',
        cleanupError,
      )
    } finally {
      lifecycle.dispose()
    }
  })
})
