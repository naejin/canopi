import { effect, signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasRuntimeHost } from '../canvas/runtime/runtime'
import { getCurrentCanvasSession, setCurrentCanvasSession } from '../canvas/session'
import { GalleryCanvasSurface } from '../../ui-gallery/GalleryCanvasSurface'
import { designFixture } from '../../ui-gallery/fixtures'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

vi.mock('../web/WebCanvasToolbar', () => ({ WebCanvasToolbar: () => null }))
vi.mock('../components/canvas/InspectionLens', () => ({ InspectionLens: () => null }))
vi.mock('../components/canvas/SpeciesFocusChip', () => ({ SpeciesFocusChip: () => null }))
vi.mock('../components/canvas/ZoomControls', () => ({ ZoomControls: () => null }))
vi.mock('../canvas/runtime/scene-runtime', () => ({ SceneCanvasRuntime: class {} }))
vi.mock('../canvas/runtime/host', () => ({ createSceneCanvasRuntimeHost: vi.fn() }))
vi.mock('../app/canvas-runtime/app-adapter', () => ({ createAppCanvasRuntimeAppAdapter: vi.fn() }))
vi.mock('../app/saved-object-stamps', () => ({
  savedObjectStampWorkbench: { saveSelection: vi.fn() },
}))

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()
  readonly unobserve = vi.fn()

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
}

describe('UI gallery canvas surface', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    setCurrentCanvasSession(null)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('releases the canvas owner on primary-route removal and creates a fresh owner on return', async () => {
    const first = fakeRuntimeHost()
    const second = fakeRuntimeHost()
    const activeSurface = signal('workspace')
    const onReadyChange = vi.fn()

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={activeSurface}
          design={designFixture()}
          dense={false}
          onReadyChange={onReadyChange}
          createRuntimeHost={() => first.host}
        />,
        container,
      )
      await Promise.resolve()
    })

    expect(first.host.init).toHaveBeenCalledOnce()
    expect(first.documents.loadDocument).toHaveBeenCalledOnce()
    expect(getCurrentCanvasSession()).toBe(first.host.surfaces)
    expect(onReadyChange).toHaveBeenLastCalledWith(true)

    act(() => render(<div data-primary-route="location" />, container))

    expect(first.host.destroy).toHaveBeenCalledOnce()
    expect(FakeResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce()
    expect(getCurrentCanvasSession()).toBeNull()
    expect(onReadyChange).toHaveBeenLastCalledWith(false)

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={activeSurface}
          design={designFixture()}
          dense={false}
          onReadyChange={onReadyChange}
          createRuntimeHost={() => second.host}
        />,
        container,
      )
      await Promise.resolve()
    })

    expect(second.host.init).toHaveBeenCalledOnce()
    expect(vi.mocked(first.host.destroy).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(second.host.init).mock.invocationCallOrder[0]!)
    expect(getCurrentCanvasSession()).toBe(second.host.surfaces)
  })

  it('ignores late initialization after cleanup and preserves the replacement session', async () => {
    let finishFirst: (() => void) | undefined
    const first = fakeRuntimeHost(() => new Promise<void>(resolve => { finishFirst = resolve }))
    const second = fakeRuntimeHost()
    const activeSurface = signal('workspace')
    const onReadyChange = vi.fn()
    const design = designFixture()

    act(() => {
      render(
        <GalleryCanvasSurface
          activeSurface={activeSurface}
          design={design}
          dense={false}
          onReadyChange={onReadyChange}
          createRuntimeHost={() => first.host}
        />,
        container,
      )
    })
    expect(finishFirst).toBeTypeOf('function')
    act(() => render(<div data-hmr-boundary />, container))
    expect(first.host.destroy).toHaveBeenCalledOnce()

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={activeSurface}
          design={design}
          dense={false}
          onReadyChange={onReadyChange}
          createRuntimeHost={() => second.host}
        />,
        container,
      )
      await Promise.resolve()
    })
    expect(getCurrentCanvasSession()).toBe(second.host.surfaces)

    await act(async () => {
      finishFirst!()
      await Promise.resolve()
    })

    expect(first.documents.loadDocument).not.toHaveBeenCalled()
    expect(first.host.destroy).toHaveBeenCalledOnce()
    expect(getCurrentCanvasSession()).toBe(second.host.surfaces)
  })

  it('keeps readiness false when publication synchronously removes the owner', async () => {
    const first = fakeRuntimeHost()
    const onReadyChange = vi.fn()
    let removed = false
    const disposePublicationEffect = effect(() => {
      if (!removed && getCurrentCanvasSession() === first.host.surfaces) {
        removed = true
        render(null, container)
      }
    })

    try {
      await act(async () => {
        render(
          <GalleryCanvasSurface
            activeSurface={signal('workspace')}
            design={designFixture()}
            dense={false}
            onReadyChange={onReadyChange}
            createRuntimeHost={() => first.host}
          />,
          container,
        )
        await Promise.resolve()
      })

      expect(first.host.destroy).toHaveBeenCalledOnce()
      expect(getCurrentCanvasSession()).toBeNull()
      expect(onReadyChange).not.toHaveBeenCalledWith(true)
      expect(onReadyChange).toHaveBeenLastCalledWith(false)
    } finally {
      disposePublicationEffect()
    }
  })

  it('does not clear a successor published reentrantly during destruction', async () => {
    const successor = fakeRuntimeHost()
    const first = fakeRuntimeHost(
      async () => {},
      () => setCurrentCanvasSession(successor.host.surfaces),
    )

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={signal('workspace')}
          design={designFixture()}
          dense={false}
          onReadyChange={() => {}}
          createRuntimeHost={() => first.host}
        />,
        container,
      )
      await Promise.resolve()
    })

    act(() => render(<div data-primary-route="location" />, container))

    expect(first.host.destroy).toHaveBeenCalledOnce()
    expect(getCurrentCanvasSession()).toBe(successor.host.surfaces)
  })
})

function fakeRuntimeHost(
  initialize: () => Promise<void> = async () => {},
  destroy: () => void = () => {},
): {
  readonly host: CanvasRuntimeHost
  readonly documents: ReturnType<typeof createTestCanvasDocumentSurface>
} {
  const documents = createTestCanvasDocumentSurface({
    loadDocument: vi.fn(),
    resize: vi.fn(),
    zoomToFit: vi.fn(),
  })
  const commands = createTestCanvasCommandSurface({
    viewport: { zoomOut: vi.fn() },
    sceneEdits: { selectSameSpecies: vi.fn() },
  })
  const surfaces = createTestCanvasRuntimeSurfaces({ commands, documents })
  return {
    documents,
    host: {
      surfaces,
      init: vi.fn(initialize),
      destroy: vi.fn(destroy),
    },
  }
}
