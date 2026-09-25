import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneRendererDefinition, SceneRendererInstance } from '../renderers/scene-types'
import { createTestSceneRendererSnapshot } from '../../../__tests__/support/scene-renderer-snapshot'
import {
  SceneRendererMountCancelledError,
  SceneRuntimeRenderScheduler,
} from './render-scheduler'

function createRenderer(id = 'maplibre-pixi'): SceneRendererInstance {
  return {
    id,
    renderScene: vi.fn(),
    setViewport: vi.fn(),
    dispose: vi.fn(),
  }
}

function definitionFor(
  renderer: SceneRendererInstance,
  initialize: SceneRendererDefinition['initialize'] = () => renderer,
): SceneRendererDefinition {
  return { id: renderer.id, initialize: vi.fn(initialize) }
}

function createScheduler(
  definition: SceneRendererDefinition | null,
  overrides: Partial<ConstructorParameters<typeof SceneRuntimeRenderScheduler>[0]> = {},
): SceneRuntimeRenderScheduler {
  return new SceneRuntimeRenderScheduler({
    getRenderer: () => definition,
    getViewport: () => ({ x: 0, y: 0, scale: 1 }),
    prepareSceneRender: async () => ({
      publish: () => createTestSceneRendererSnapshot(),
    }),
    renderChrome: vi.fn(),
    ...overrides,
  })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('SceneRuntimeRenderScheduler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mounts the one supplied renderer and never selects another', async () => {
    const renderer = createRenderer()
    const definition = definitionFor(renderer)
    const scheduler = createScheduler(definition)
    const container = document.createElement('div')

    await scheduler.initialize(container)
    await scheduler.renderScene()

    expect(definition.initialize).toHaveBeenCalledExactlyOnceWith({ container })
    expect(scheduler.container).toBe(container)
    expect(renderer.renderScene).toHaveBeenCalledOnce()
    scheduler.dispose()
  })

  it('refuses to mount when the runtime has no renderer', async () => {
    const scheduler = createScheduler(null)

    await expect(scheduler.initialize(document.createElement('div')))
      .rejects.toThrow('no renderer to mount')
    expect(scheduler.container).toBeNull()
  })

  it('surfaces a renderer mount failure instead of falling back', async () => {
    const failure = new Error('WebGL2 unavailable')
    const renderer = createRenderer()
    const scheduler = createScheduler(definitionFor(renderer, () => { throw failure }))

    await expect(scheduler.initialize(document.createElement('div'))).rejects.toBe(failure)
    expect(scheduler.container).toBeNull()
    await scheduler.renderScene()
    expect(renderer.renderScene).not.toHaveBeenCalled()
  })

  it('coalesces a burst of camera changes into one frame using the latest viewport', async () => {
    let frame!: FrameRequestCallback
    const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 })
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const renderer = createRenderer()
    let viewport = { x: 0, y: 0, scale: 20 }
    const scheduler = createScheduler(definitionFor(renderer), { getViewport: () => viewport })
    await scheduler.initialize(document.createElement('div'))
    for (let i = 0; i < 10; i++) {
      viewport = { x: i, y: i, scale: 20 + i }
      scheduler.invalidate('viewport')
    }
    expect(request).toHaveBeenCalledOnce()
    expect(renderer.setViewport).not.toHaveBeenCalled()
    frame(0)
    await vi.waitFor(() => expect(renderer.setViewport).toHaveBeenCalledExactlyOnceWith(viewport))
    scheduler.dispose()
  })

  it('treats a resize as a camera-only update because MapLibre owns the surface size', async () => {
    const renderer = createRenderer()
    const renderChrome = vi.fn()
    const scheduler = createScheduler(definitionFor(renderer), { renderChrome })
    await scheduler.initialize(document.createElement('div'))

    scheduler.resize(400, 300)

    expect(renderer.setViewport).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 0, scale: 1 })
    expect(renderer.renderScene).not.toHaveBeenCalled()
    expect(renderChrome).toHaveBeenCalledOnce()
    scheduler.dispose()
  })

  it('coalesces scene edits with camera events, and cancels the pending frame on disposal', async () => {
    let frame!: FrameRequestCallback
    const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7 })
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const renderer = createRenderer()
    const scheduler = createScheduler(definitionFor(renderer))
    await scheduler.initialize(document.createElement('div'))
    scheduler.invalidate('viewport')
    scheduler.invalidate('scene')
    scheduler.invalidate('scene')
    scheduler.invalidate('viewport')
    await Promise.resolve()
    expect(renderer.renderScene).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledOnce()
    frame(0)
    await vi.waitFor(() => expect(renderer.renderScene).toHaveBeenCalledOnce())
    expect(renderer.setViewport).not.toHaveBeenCalled()
    scheduler.invalidate('scene')
    scheduler.dispose()
    expect(cancel).toHaveBeenCalledWith(7)
  })

  it('unmounts the renderer so later invalidations draw nothing', async () => {
    const request = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const renderer = createRenderer()
    const scheduler = createScheduler(definitionFor(renderer))
    await scheduler.initialize(document.createElement('div'))

    await scheduler.unmount()
    scheduler.invalidate('scene')
    scheduler.resize(400, 300)
    await scheduler.renderScene()

    expect(renderer.dispose).toHaveBeenCalledOnce()
    expect(scheduler.container).toBeNull()
    expect(request).not.toHaveBeenCalled()
    expect(renderer.renderScene).not.toHaveBeenCalled()
    expect(renderer.setViewport).not.toHaveBeenCalled()
  })

  it('does not draw a prepared scene after unmount overtakes its preparation', async () => {
    const preparation = deferred<{ publish(): ReturnType<typeof createTestSceneRendererSnapshot> }>()
    const renderer = createRenderer()
    const scheduler = createScheduler(definitionFor(renderer), {
      prepareSceneRender: () => preparation.promise,
    })
    await scheduler.initialize(document.createElement('div'))

    const render = scheduler.renderScene()
    await scheduler.unmount()
    preparation.resolve({ publish: () => createTestSceneRendererSnapshot() })
    await render

    expect(renderer.renderScene).not.toHaveBeenCalled()
  })

  it('rejects a second mount while one is pending or active', async () => {
    const pendingRenderer = deferred<SceneRendererInstance>()
    const renderer = createRenderer()
    const scheduler = createScheduler(definitionFor(renderer, () => pendingRenderer.promise))
    const acceptedContainer = document.createElement('div')

    const acceptedInitialization = scheduler.initialize(acceptedContainer)
    await expect(scheduler.initialize(document.createElement('div'))).rejects.toThrow('already mounted')
    pendingRenderer.resolve(renderer)
    await acceptedInitialization

    expect(scheduler.container).toBe(acceptedContainer)
    await expect(scheduler.initialize(document.createElement('div'))).rejects.toThrow('already mounted')
    scheduler.dispose()
  })

  it('disposes a renderer whose mount settles after disposal', async () => {
    const pendingRenderer = deferred<SceneRendererInstance>()
    const renderer = createRenderer()
    const scheduler = createScheduler(definitionFor(renderer, () => pendingRenderer.promise))

    const initialization = scheduler.initialize(document.createElement('div'))
    scheduler.dispose()
    pendingRenderer.resolve(renderer)

    await expect(initialization).rejects.toBeInstanceOf(SceneRendererMountCancelledError)
    expect(scheduler.container).toBeNull()
    expect(renderer.dispose).toHaveBeenCalledOnce()
  })

  it('reports a real failure from a detached resize', async () => {
    const resizeError = new Error('renderer viewport failed')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const renderer = {
      ...createRenderer(),
      setViewport: () => { throw resizeError },
    }
    const scheduler = createScheduler(definitionFor(renderer))
    await scheduler.initialize(document.createElement('div'))

    scheduler.resize(400, 300)

    await vi.waitFor(() => expect(logError).toHaveBeenCalledOnce())
    expect(logError).toHaveBeenCalledWith('Scene Canvas resize failed:', resizeError)
    scheduler.dispose()
  })
})
