import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesignSessionLifecycle } from '../app/document-session/lifecycle'
import {
  createTestCanvasDocumentSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'
import type { CanvasRuntimeHost, CanvasRuntimeSurfaces } from '../canvas/runtime/runtime'

vi.mock('../app/document-session/transition', () => ({
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
    const publishSurfaces = vi.fn<(surfaces: CanvasRuntimeSurfaces | null) => void>()
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

    expect(init.mock.calls[0]?.[0]).toBe(container)
    expect(publishSurfaces.mock.calls[0]?.[0]).toBe(surfaces)
    expect(initializeViewport).toHaveBeenCalledTimes(1)
    expect(attachRulersTo.mock.calls[0]?.[0]).toBe(rulerOverlay)
    expect(logError).not.toHaveBeenCalled()

    lifecycle.dispose()

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(publishSurfaces.mock.calls[publishSurfaces.mock.calls.length - 1]?.[0]).toBe(null)
  })
})
