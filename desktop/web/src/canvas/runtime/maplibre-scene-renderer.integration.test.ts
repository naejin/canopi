import { describe, expect, it, vi } from 'vitest'
import { SceneCanvasRuntime } from './scene-runtime'
import { createCanvas2DSceneRenderer } from './renderers/canvas2d-scene'
import {
  MapLibreSceneRendererBridge,
  type MapLibreSceneRenderTarget,
} from './renderers/maplibre-scene'
import type { RendererCapabilities } from './renderers/types'

const TEST_CAPABILITIES: RendererCapabilities = {
  domCanvas: true,
  canvas2d: true,
  offscreenCanvas: false,
  offscreenCanvas2d: false,
  webgl: true,
  webgl2: true,
  webgpu: false,
  imageBitmap: false,
  createImageBitmap: false,
  worker: false,
  devicePixelRatio: 2,
  prefersReducedMotion: false,
}

describe('SceneCanvasRuntime MapLibre renderer composition', () => {
  it('publishes its initial scene without adding an independent render surface', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const runtime = new SceneCanvasRuntime({
      renderer: {
        capabilities: TEST_CAPABILITIES,
        backends: [bridge.createRenderer(), createCanvas2DSceneRenderer()],
      },
    })
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    })

    await runtime.init(container)
    expect(container.querySelector('canvas')).toBeNull()

    const target = {
      setSnapshot: vi.fn(),
      requestRender: vi.fn(),
    } satisfies MapLibreSceneRenderTarget
    bridge.connect(target)
    expect(target.setSnapshot).toHaveBeenCalledOnce()

    runtime.destroy()
  })

  it('eagerly replaces an externally failed shared backend with Canvas2D', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const runtime = new SceneCanvasRuntime({
      renderer: {
        capabilities: TEST_CAPABILITIES,
        backends: [bridge.createRenderer(), createCanvas2DSceneRenderer()],
      },
    })
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    })
    bridge.connect({ setSnapshot: vi.fn(), requestRender: vi.fn() })
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    await runtime.init(container)
    await runtime.reportRendererFailure('maplibre-pixi', new Error('map context lost'))

    expect(container.querySelector('[data-canopi-renderer="canvas2d"]')).not.toBeNull()
    getContext.mockRestore()
    runtime.destroy()
  })
})
