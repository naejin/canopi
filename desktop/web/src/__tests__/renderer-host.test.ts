import { describe, expect, it, vi } from 'vitest'
import { RendererHost } from '../canvas/runtime/renderers/host'
import type {
  RendererBackendContext,
  RendererBackendDefinition,
  RendererBackendInstance,
} from '../canvas/runtime/renderers/types'

interface TestContext {
  value: string
}

interface TestInstance extends RendererBackendInstance {
  render: () => string
}

function createBackend(
  id: string,
  options: {
    initialize?: (context: TestContext, backendContext: RendererBackendContext) => TestInstance | Promise<TestInstance>
    supports?: (capabilities: Parameters<NonNullable<RendererBackendDefinition<TestContext>['supports']>>[0]) => boolean
  } = {},
): RendererBackendDefinition<TestContext, TestInstance> {
  return {
    id,
    supports: options.supports,
    async initialize(context, backendContext) {
      if (options.initialize) {
        return options.initialize(context, backendContext)
      }

      return {
        id,
        dispose: vi.fn(),
        render: () => `${context.value}:${backendContext.backendId}`,
      }
    },
  }
}

describe('RendererHost', () => {
  it('initializes the first supported backend', async () => {
    const host = new RendererHost<TestContext, TestInstance>({
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: true,
        webgl2: true,
        webgpu: false,
        imageBitmap: true,
        createImageBitmap: true,
        worker: true,
        devicePixelRatio: 2,
        prefersReducedMotion: false,
      },
      backends: [
        createBackend('pixi'),
        createBackend('canvas2d'),
      ],
    })

    const instance = await host.initialize({ value: 'scene' })

    expect(instance.id).toBe('pixi')
    expect(host.snapshot.activeBackendId).toBe('pixi')
  })

  it('falls back when the preferred backend fails to initialize', async () => {
    const host = new RendererHost<TestContext, TestInstance>({
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: true,
        webgl2: true,
        webgpu: false,
        imageBitmap: true,
        createImageBitmap: true,
        worker: true,
        devicePixelRatio: 2,
        prefersReducedMotion: false,
      },
      backends: [
        createBackend('pixi', {
          initialize: async () => {
            throw new Error('gpu failed')
          },
        }),
        createBackend('canvas2d'),
      ],
    })

    const instance = await host.initialize({ value: 'scene' })

    expect(instance.id).toBe('canvas2d')
    expect(host.snapshot.failedBackendIds).toContain('pixi')
    expect(host.snapshot.activeBackendId).toBe('canvas2d')
  })

  it('fails over and retries the operation after runtime failure', async () => {
    let shouldFail = true
    const pixiDispose = vi.fn()

    const host = new RendererHost<TestContext, TestInstance>({
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: true,
        webgl2: true,
        webgpu: false,
        imageBitmap: true,
        createImageBitmap: true,
        worker: true,
        devicePixelRatio: 2,
        prefersReducedMotion: false,
      },
      backends: [
        createBackend('pixi', {
          initialize: async () => ({
            id: 'pixi',
            dispose: pixiDispose,
            render: () => 'pixi',
          }),
        }),
        createBackend('canvas2d', {
          initialize: async () => ({
            id: 'canvas2d',
            dispose: vi.fn(),
            render: () => 'canvas2d',
          }),
        }),
      ],
    })

    await host.initialize({ value: 'scene' })

    const value = await host.run(async (instance) => {
      if (instance.id === 'pixi' && shouldFail) {
        shouldFail = false
        throw new Error('context lost')
      }
      return instance.render()
    }, {
      operationName: 'render',
    })

    expect(value).toBe('canvas2d')
    expect(pixiDispose).toHaveBeenCalledTimes(1)
    expect(host.snapshot.activeBackendId).toBe('canvas2d')
  })
})
