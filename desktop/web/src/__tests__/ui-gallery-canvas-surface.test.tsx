import { effect, signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceRuntimeComposition } from '../app/canvas-map-surface/workspace-runtime-composition'
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
vi.mock('../../ui-gallery/gallery-workspace-runtime', () => ({ createGalleryWorkspaceRuntimeComposition: vi.fn() }))

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

  afterEach(async () => {
    await act(async () => {
      render(null, container)
      await flushMicrotasks()
    })
    container.remove()
    setCurrentCanvasSession(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('releases the canvas owner on primary-route removal and creates a fresh owner on return', async () => {
    const first = fakeRuntimeComposition()
    const second = fakeRuntimeComposition()
    const activeSurface = signal('workspace')
    const onReadyChange = vi.fn()

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={activeSurface}
          design={designFixture()}
          dense={false}
          onReadyChange={onReadyChange}
          createRuntimeComposition={() => first.host}
        />,
        container,
      )
      await flushMicrotasks()
    })

    await vi.waitFor(() => expect(first.documents.loadDocument).toHaveBeenCalledOnce())

    expect(first.host.start).toHaveBeenCalledOnce()
    expect(getCurrentCanvasSession()).toBe(first.host.surfaces)
    expect(onReadyChange).toHaveBeenLastCalledWith(true)

    await act(async () => {
      render(<div data-primary-route="location" />, container)
      await flushMicrotasks()
    })

    await vi.waitFor(() => expect(first.host.dispose).toHaveBeenCalledOnce())

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
          createRuntimeComposition={() => second.host}
        />,
        container,
      )
      await flushMicrotasks()
    })

    await vi.waitFor(() => expect(second.host.start).toHaveBeenCalledOnce())

    expect(vi.mocked(first.host.dispose).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(second.host.start).mock.invocationCallOrder[0]!)
    await vi.waitFor(() => expect(getCurrentCanvasSession() === second.host.surfaces).toBe(true))
  })

  it('ignores late initialization after cleanup and preserves the replacement session', async () => {
    let finishFirst: (() => void) | undefined
    const first = fakeRuntimeComposition(() => new Promise<void>(resolve => { finishFirst = resolve }))
    const second = fakeRuntimeComposition()
    const activeSurface = signal('workspace')
    const onReadyChange = vi.fn()
    const design = designFixture()

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={activeSurface}
          design={design}
          dense={false}
          onReadyChange={onReadyChange}
          createRuntimeComposition={() => first.host}
        />,
        container,
      )
      await flushMicrotasks()
    })
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
    await act(async () => {
      render(<div data-hmr-boundary />, container)
      await flushMicrotasks()
    })
    await vi.waitFor(() => expect(first.host.dispose).toHaveBeenCalledOnce())

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={activeSurface}
          design={design}
          dense={false}
          onReadyChange={onReadyChange}
          createRuntimeComposition={() => second.host}
        />,
        container,
      )
      await flushMicrotasks()
    })
    await vi.waitFor(() => expect(getCurrentCanvasSession()).toBe(second.host.surfaces))

    await act(async () => {
      finishFirst!()
      await flushMicrotasks()
    })

    expect(first.documents.loadDocument).not.toHaveBeenCalled()
    expect(first.host.dispose).toHaveBeenCalledOnce()
    expect(getCurrentCanvasSession()).toBe(second.host.surfaces)
  })

  it('keeps readiness false when publication synchronously removes the owner', async () => {
    const first = fakeRuntimeComposition()
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
            createRuntimeComposition={() => first.host}
          />,
          container,
        )
        await flushMicrotasks()
      })

      await vi.waitFor(() => expect(first.host.dispose).toHaveBeenCalledOnce())

      expect(getCurrentCanvasSession()).toBeNull()
      expect(onReadyChange).not.toHaveBeenCalledWith(true)
      expect(onReadyChange).toHaveBeenLastCalledWith(false)
    } finally {
      disposePublicationEffect()
    }
  })

  it('does not clear a successor published reentrantly during destruction', async () => {
    const successor = fakeRuntimeComposition()
    const first = fakeRuntimeComposition(
      async () => {},
      async () => setCurrentCanvasSession(successor.host.surfaces),
    )

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={signal('workspace')}
          design={designFixture()}
          dense={false}
          onReadyChange={() => {}}
          createRuntimeComposition={() => first.host}
        />,
        container,
      )
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(getCurrentCanvasSession()).toBe(first.host.surfaces))

    await act(async () => {
      render(<div data-primary-route="location" />, container)
      await flushMicrotasks()
    })

    await vi.waitFor(() => expect(first.host.dispose).toHaveBeenCalledOnce())

    expect(getCurrentCanvasSession()).toBe(successor.host.surfaces)
  })

  it('waits for asynchronous destruction before constructing a replacement owner', async () => {
    let finishDestroy: (() => void) | undefined
    const first = fakeRuntimeComposition(
      async () => {},
      () => new Promise<void>(resolve => { finishDestroy = resolve }),
    )
    const second = fakeRuntimeComposition()
    const activeSurface = signal('workspace')
    const onReadyChange = vi.fn()
    const createSecond = vi.fn(() => second.host)

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={activeSurface}
          design={designFixture()}
          dense={false}
          onReadyChange={onReadyChange}
          createRuntimeComposition={() => first.host}
        />,
        container,
      )
      await flushMicrotasks()
    })

    await vi.waitFor(() => expect(getCurrentCanvasSession()).toBe(first.host.surfaces))

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={activeSurface}
          design={designFixture()}
          dense={false}
          onReadyChange={onReadyChange}
          createRuntimeComposition={createSecond}
        />,
        container,
      )
      await flushMicrotasks()
    })

    await vi.waitFor(() => expect(first.host.dispose).toHaveBeenCalledOnce())

    expect(finishDestroy).toBeTypeOf('function')
    expect(createSecond).not.toHaveBeenCalled()
    expect(second.host.start).not.toHaveBeenCalled()

    await act(async () => {
      finishDestroy!()
      await flushMicrotasks()
    })

    await vi.waitFor(() => expect(second.host.start).toHaveBeenCalledOnce())

    expect(createSecond).toHaveBeenCalledOnce()
    expect(getCurrentCanvasSession()).toBe(second.host.surfaces)
  })
})

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve()
  }
}

function fakeRuntimeComposition(
  initialize: () => Promise<void> = async () => {},
  destroy: () => Promise<void> = async () => {},
): {
  readonly host: WorkspaceRuntimeComposition
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
      start: vi.fn(async () => {
        await initialize()
        return 'shared-ready' as const
      }),
      dispose: vi.fn(destroy),
    },
  }
}
