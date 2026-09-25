import { describe, expect, it, vi } from 'vitest'
import { SceneCanvasRuntime } from './scene-runtime'
import {
  MapLibreSceneRendererBridge,
  type MapLibreSceneRenderTarget,
} from './renderers/maplibre-scene'

function createContainer(): HTMLElement {
  const container = document.createElement('div')
  Object.defineProperties(container, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  })
  return container
}

describe('SceneCanvasRuntime MapLibre renderer composition', () => {
  it('publishes its initial scene without adding an independent render surface', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const runtime = new SceneCanvasRuntime({ renderer: bridge.createRenderer() })
    const container = createContainer()

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

  it('unmounts after a map failure without mounting a replacement renderer', async () => {
    const bridge = new MapLibreSceneRendererBridge()
    const runtime = new SceneCanvasRuntime({ renderer: bridge.createRenderer() })
    const container = createContainer()
    const target = { setSnapshot: vi.fn(), requestRender: vi.fn() } satisfies MapLibreSceneRenderTarget
    bridge.connect(target)

    await runtime.init(container)
    target.setSnapshot.mockClear()
    await runtime.unmountRenderer()
    runtime.commandSurface.viewport.zoomIn()
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(container.querySelector('canvas')).toBeNull()
    expect(target.setSnapshot).not.toHaveBeenCalled()
    expect(target.requestRender).not.toHaveBeenCalled()
    // A later map may connect, but the unmounted renderer publishes nothing to it.
    const nextTarget = { setSnapshot: vi.fn(), requestRender: vi.fn() } satisfies MapLibreSceneRenderTarget
    bridge.connect(nextTarget)
    expect(nextTarget.setSnapshot).not.toHaveBeenCalled()
    runtime.destroy()
  })
})
