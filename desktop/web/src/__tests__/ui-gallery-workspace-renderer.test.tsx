import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAPLIBRE_SCENE_RENDERER_ID } from '../canvas/runtime/renderers/maplibre-scene'
import { setCurrentCanvasSession } from '../canvas/session'
import type { SharedMapSceneRendererComposition } from '../maplibre/shared-scene-renderer'
import { GalleryCanvasSurface } from '../../ui-gallery/GalleryCanvasSurface'
import { designFixture } from '../../ui-gallery/fixtures'

const rendererCompositions = vi.hoisted(() => [] as SharedMapSceneRendererComposition[])

vi.mock('../maplibre/shared-scene-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../maplibre/shared-scene-renderer')>()
  return {
    ...actual,
    createSharedMapSceneRendererComposition: () => {
      const composition = actual.createSharedMapSceneRendererComposition()
      rendererCompositions.push(composition)
      return composition
    },
  }
})
vi.mock('../web/WebCanvasToolbar', () => ({ WebCanvasToolbar: () => null }))
vi.mock('../components/canvas/InspectionLens', () => ({ InspectionLens: () => null }))
vi.mock('../components/canvas/SpeciesFocusChip', () => ({ SpeciesFocusChip: () => null }))
vi.mock('../components/canvas/CanvasOverview', () => ({ CanvasOverview: () => null }))
vi.mock('../components/canvas/ZoomControls', () => ({ ZoomControls: () => null }))

class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('UI gallery workspace renderer', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    rendererCompositions.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    vi.stubGlobal('ResizeObserver', InertResizeObserver)
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

  it('builds the gallery canvas on the production maplibre-pixi renderer', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onReadyChange = vi.fn()

    await act(async () => {
      render(
        <GalleryCanvasSurface
          activeSurface={signal('workspace')}
          design={designFixture()}
          dense={false}
          onReadyChange={onReadyChange}
        />,
        container,
      )
      await flushMicrotasks()
    })

    // jsdom has no WebGL2, so the shared workspace resolves map-unavailable
    // and keeps the Design loaded; the gallery must still have composed the
    // runtime with the one map renderer rather than a renderer-less runtime.
    await vi.waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true))

    expect(rendererCompositions).toHaveLength(1)
    expect(rendererCompositions[0]?.renderer.id).toBe(MAPLIBRE_SCENE_RENDERER_ID)
    expect(consoleError.mock.calls.flat().map(String).join('\n'))
      .not.toContain('no renderer to mount')
  })
})

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve()
  }
}
