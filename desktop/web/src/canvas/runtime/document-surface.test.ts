import { describe, expect, it, vi } from 'vitest'
import { CameraController } from './camera'
import { createSceneCanvasDocumentSurface } from './document-surface'
import { createDefaultScenePersistedState } from './scene'

describe('Scene Canvas document surface lifecycle', () => {
  it('continues destroying every owner after interaction disposal fails', () => {
    const calls: string[] = []
    const surface = createSceneCanvasDocumentSurface({
      documents: {
        loadDocument: vi.fn(),
        replaceDocument: vi.fn(),
        serializeDocument: vi.fn((_metadata, document) => document),
        markSaved: vi.fn(),
        clearHistory: vi.fn(),
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
        renderScene: vi.fn(async () => {}),
        resize: vi.fn(),
        dispose: () => {
          calls.push('rendering')
        },
      },
      getSceneSnapshot: createDefaultScenePersistedState,
      createPlantPresentationContext: () => {
        throw new Error('not used by destroy')
      },
      setViewport: vi.fn(),
      invalidateViewport: vi.fn(),
      renderChrome: vi.fn(),
      addGuide: vi.fn(),
      clearHoveredEntity: () => {
        calls.push('hover')
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
    expect(calls).toEqual(['hover', 'interaction', 'chrome', 'effects', 'rendering'])
  })
})
