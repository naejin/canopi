import { describe, expect, it, vi } from 'vitest'
import { CameraController } from './camera'
import { createSceneCanvasDocumentSurface } from './document-surface'
import {
  CanvasAuthorityBusyError,
  CanvasDocumentReplacementNotAdmittedError,
  createCanvasDocumentReplacementToken,
  type CanvasDocumentSurface,
} from './runtime'
import { createDefaultScenePersistedState, SceneStore } from './scene'

function createTestDocumentSurface(
  documents: Parameters<typeof createSceneCanvasDocumentSurface>[0]['documents'],
  renderingOverrides: Partial<
    Parameters<typeof createSceneCanvasDocumentSurface>[0]['rendering']
  > & { invalidate?: (kind: 'scene' | 'viewport' | 'chrome') => void } = {},
): CanvasDocumentSurface {
  const rendering = {
    container: null,
    invalidate: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    ...renderingOverrides,
  } as Parameters<typeof createSceneCanvasDocumentSurface>[0]['rendering']
  return createSceneCanvasDocumentSurface({
    documents,
    camera: new CameraController(),
    chrome: {
      attach: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      destroy: vi.fn(),
    },
    rendering,
    getSceneSnapshot: createDefaultScenePersistedState,
    createPlantPresentationContext: vi.fn(),
    invalidateViewport: vi.fn(),
    renderChrome: vi.fn(),
    addGuide: vi.fn(),
    clearHoveredEntity: vi.fn(),
    disposeRuntime: vi.fn(),
    disposeInteraction: vi.fn(),
    disposeEffects: vi.fn(),
  })
}

describe('Scene Canvas document surface lifecycle', () => {
  it('routes viewport initialization rendering through contained invalidation', () => {
    const invalidate = vi.fn()
    const surface = createTestDocumentSurface({
      loadDocument: vi.fn(),
      replaceDocument: vi.fn((_file, _token, finalizeReplacement) => {
        finalizeReplacement()
        return { callerFinalizerInvoked: true }
      }),
      captureForPersistence: vi.fn((_metadata, document) => ({
        content: document,
        isCurrent: () => true,
        acknowledgeSaved: () => 'applied',
      })),
    }, {
      container: document.createElement('div'),
      invalidate,
    })

    surface.initializeViewport()

    expect(invalidate).toHaveBeenCalledWith('scene')
  })

  it('continues destroying every owner after interaction disposal fails', () => {
    const calls: string[] = []
    const surface = createSceneCanvasDocumentSurface({
      documents: {
        loadDocument: vi.fn(),
        replaceDocument: vi.fn((_file, _token, finalizeReplacement) => {
          finalizeReplacement()
          return { callerFinalizerInvoked: true }
        }),
        captureForPersistence: vi.fn((_metadata, document) => ({
          content: document,
          isCurrent: () => true,
          acknowledgeSaved: () => 'applied',
        })),
      },
      camera: new CameraController(),
      chrome: {
        attach: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        destroy: () => {
          calls.push('chrome')
        },
      },
      rendering: {
        container: null,
        invalidate: vi.fn(),
        resize: vi.fn(),
        dispose: () => {
          calls.push('rendering')
        },
      },
      getSceneSnapshot: createDefaultScenePersistedState,
      createPlantPresentationContext: () => {
        throw new Error('not used by destroy')
      },
      invalidateViewport: vi.fn(),
      renderChrome: vi.fn(),
      addGuide: vi.fn(),
      clearHoveredEntity: () => {
        calls.push('hover')
      },
      disposeRuntime: () => {
        calls.push('runtime')
      },
      disposeInteraction: () => {
        calls.push('interaction')
        throw new Error('interaction disposal failed')
      },
      disposeEffects: () => {
        calls.push('effects')
      },
    })

    expect(() => surface.destroy()).toThrow('interaction disposal failed')
    expect(calls).toEqual(['runtime', 'hover', 'interaction', 'chrome', 'effects', 'rendering'])
  })

  it('keeps first hydration authority-owned and persistence-busy until settlement succeeds', () => {
    const file = new SceneStore().toCanopiFile()
    const captureForPersistence = vi.fn((_metadata, document) => ({
      content: document,
      isCurrent: () => true,
      acknowledgeSaved: () => 'applied' as const,
    }))
    let failHydration = true
    let surface!: CanvasDocumentSurface
    const loadDocument = vi.fn(() => {
      expect(surface.hasLoadedDocument()).toBe(true)
      expect(() => surface.captureForPersistence({ name: file.name }, file))
        .toThrow(CanvasAuthorityBusyError)
      if (failHydration) throw new Error('late hydration publication failed')
    })
    surface = createTestDocumentSurface({
      loadDocument,
      replaceDocument: vi.fn((_file, _token, finalizeReplacement) => {
        finalizeReplacement()
        return { callerFinalizerInvoked: true }
      }),
      captureForPersistence,
    })

    expect(() => surface.loadDocument(file)).toThrow('late hydration publication failed')
    expect(surface.hasLoadedDocument()).toBe(true)
    expect(() => surface.captureForPersistence({ name: file.name }, file))
      .toThrow('document-settlement')
    expect(captureForPersistence).not.toHaveBeenCalled()

    failHydration = false
    surface.loadDocument(file)

    expect(() => surface.captureForPersistence({ name: file.name }, file)).not.toThrow()
    expect(captureForPersistence).toHaveBeenCalledOnce()
  })

  it('keeps replacement persistence-busy across a late failure and retry', () => {
    const file = new SceneStore().toCanopiFile()
    const captureForPersistence = vi.fn((_metadata, document) => ({
      content: document,
      isCurrent: () => true,
      acknowledgeSaved: () => 'applied' as const,
    }))
    let failReplacement = true
    const replaceDocument = vi.fn((_file, _token, finalizeReplacement: () => void) => {
      finalizeReplacement()
      if (failReplacement) throw new Error('late replacement publication failed')
      return { callerFinalizerInvoked: true }
    })
    const surface = createTestDocumentSurface({
      loadDocument: vi.fn(),
      replaceDocument,
      captureForPersistence,
    })
    surface.loadDocument(file)
    const token = createCanvasDocumentReplacementToken()

    expect(() => surface.replaceDocument(file, token, vi.fn()))
      .toThrow('late replacement publication failed')
    expect(() => surface.captureForPersistence({ name: file.name }, file))
      .toThrow('document-settlement')

    failReplacement = false
    expect(surface.replaceDocument(file, token, vi.fn())).toEqual({
      callerFinalizerInvoked: true,
    })
    expect(() => surface.captureForPersistence({ name: file.name }, file)).not.toThrow()
  })

  it('restores the prior document state when replacement is not admitted', () => {
    const current = new SceneStore().toCanopiFile()
    const preparationError = new Error('replacement preparation failed')
    const captureForPersistence = vi.fn((_metadata, document) => ({
      content: document,
      isCurrent: () => true,
      acknowledgeSaved: () => 'applied' as const,
    }))
    const surface = createTestDocumentSurface({
      loadDocument: vi.fn(),
      replaceDocument: vi.fn(() => {
        throw new CanvasDocumentReplacementNotAdmittedError(preparationError)
      }),
      captureForPersistence,
    })
    surface.loadDocument(current)

    expect(() => surface.replaceDocument(
      current,
      createCanvasDocumentReplacementToken(),
      vi.fn(),
    )).toThrow('replacement preparation failed')
    expect(() => surface.captureForPersistence({ name: current.name }, current))
      .not.toThrow()
    expect(captureForPersistence).toHaveBeenCalledOnce()
  })
})
