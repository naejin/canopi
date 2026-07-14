import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RendererHost,
  RendererHostInitializationCancelledError,
} from '../renderers'
import type {
  SceneRendererDefinition,
  SceneRendererInstance,
  SceneRendererSnapshot,
} from '../renderers/scene-types'
import {
  SceneRuntimeRenderScheduler,
  type SceneRuntimePreparedRender,
} from './render-scheduler'

function createRenderer(id: string): SceneRendererInstance {
  return {
    id,
    resize: vi.fn(),
    renderScene: vi.fn(),
    setViewport: vi.fn(),
    dispose: vi.fn(),
  }
}

function createBackend(id: string): SceneRendererDefinition {
  return {
    id,
    initialize: async () => createRenderer(id),
  }
}

function createScheduler(
  host: RendererHost<{ container: HTMLElement }, SceneRendererInstance>,
): SceneRuntimeRenderScheduler {
  return new SceneRuntimeRenderScheduler({
    getRendererHost: () => host,
    getViewport: () => ({ x: 0, y: 0, scale: 1 }),
    prepareSceneRender: async () => ({
      publish: () => ({}) as SceneRendererSnapshot,
    }),
    renderChrome: vi.fn(),
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
    vi.restoreAllMocks()
  })

  it('contains expected viewport cancellation when teardown overtakes invalidation', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = new RendererHost({
      backends: [createBackend('pixi'), createBackend('canvas2d')],
    })
    const scheduler = createScheduler(host)
    await scheduler.initialize(document.createElement('div'))

    scheduler.invalidate('viewport')
    scheduler.dispose()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(host.snapshot.initialized).toBe(false)
    expect(logError).not.toHaveBeenCalled()
  })

  it('publishes only the container whose renderer initialization succeeds', async () => {
    const pendingRenderer = deferred<SceneRendererInstance>()
    const renderer = createRenderer('pixi')
    const host = new RendererHost<{ container: HTMLElement }, SceneRendererInstance>({
      backends: [{
        id: 'pixi',
        initialize: () => pendingRenderer.promise,
      }, createBackend('canvas2d')],
    })
    const scheduler = createScheduler(host)
    const acceptedContainer = document.createElement('div')
    const rejectedContainer = document.createElement('div')

    const acceptedInitialization = scheduler.initialize(acceptedContainer)
    await expect(scheduler.initialize(rejectedContainer)).rejects.toThrow(
      'already has an active or pending backend',
    )
    pendingRenderer.resolve(renderer)
    await acceptedInitialization

    expect(scheduler.container).toBe(acceptedContainer)
    await scheduler.renderScene()
    expect(renderer.renderScene).toHaveBeenCalledOnce()
    scheduler.dispose()
  })

  it('does not publish a container after post-selection disposal wins initialization', async () => {
    const renderer = createRenderer('pixi')
    let scheduler!: SceneRuntimeRenderScheduler
    const host = new RendererHost<{ container: HTMLElement }, SceneRendererInstance>({
      backends: [{
        id: 'pixi',
        initialize: async () => renderer,
      }, createBackend('canvas2d')],
      onBackendChange: () => {
        queueMicrotask(() => scheduler.dispose())
      },
    })
    scheduler = createScheduler(host)

    await expect(scheduler.initialize(document.createElement('div')))
      .rejects.toBeInstanceOf(RendererHostInitializationCancelledError)

    expect(scheduler.container).toBeNull()
    expect(renderer.dispose).toHaveBeenCalledOnce()
    expect(host.snapshot.activeBackendId).toBeNull()
  })

  it('contains expected scene-render cancellation when teardown overtakes invalidation', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = new RendererHost({
      backends: [createBackend('pixi'), createBackend('canvas2d')],
    })
    const scheduler = createScheduler(host)
    await scheduler.initialize(document.createElement('div'))

    scheduler.invalidate('scene')
    await Promise.resolve()
    scheduler.dispose()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(host.snapshot.initialized).toBe(false)
    expect(logError).not.toHaveBeenCalled()
  })

  it('contains expected resize cancellation when teardown overtakes the resize', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = new RendererHost({
      backends: [createBackend('pixi'), createBackend('canvas2d')],
    })
    const scheduler = createScheduler(host)
    await scheduler.initialize(document.createElement('div'))

    scheduler.resize(400, 300)
    scheduler.dispose()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(host.snapshot.initialized).toBe(false)
    expect(logError).not.toHaveBeenCalled()
  })

  it('reports a real failure from a detached resize', async () => {
    const resizeError = new Error('renderer resize failed')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failingBackend = (id: string): SceneRendererDefinition => ({
      id,
      initialize: async () => ({
        ...createRenderer(id),
        resize: () => {
          throw resizeError
        },
      }),
    })
    const host = new RendererHost({
      backends: [failingBackend('pixi'), failingBackend('canvas2d')],
    })
    const scheduler = createScheduler(host)
    await scheduler.initialize(document.createElement('div'))

    scheduler.resize(400, 300)

    await vi.waitFor(() => {
      expect(logError).toHaveBeenCalledOnce()
    })
    expect(logError).toHaveBeenCalledWith(
      'Scene Canvas resize failed:',
      expect.objectContaining({ name: 'RendererHostInitializationError' }),
    )
    scheduler.dispose()
  })

  it('does not publish an older snapshot after a newer render starts during acquisition', async () => {
    const renderer = createRenderer('pixi')
    const host = new RendererHost<{ container: HTMLElement }, SceneRendererInstance>({
      backends: [{
        id: 'pixi',
        initialize: async () => renderer,
      }, createBackend('canvas2d')],
    })
    const secondPreparation = deferred<SceneRuntimePreparedRender>()
    const firstSnapshot = {} as SceneRendererSnapshot
    const renderChrome = vi.fn()
    let scheduler!: SceneRuntimeRenderScheduler
    let preparationCount = 0
    scheduler = new SceneRuntimeRenderScheduler({
      getRendererHost: () => host,
      getViewport: () => ({ x: 0, y: 0, scale: 1 }),
      prepareSceneRender: vi.fn(async () => {
        preparationCount += 1
        if (preparationCount === 1) {
          return {
            publish: () => {
              queueMicrotask(() => scheduler.invalidate('scene'))
              return firstSnapshot
            },
          }
        }
        return secondPreparation.promise
      }),
      renderChrome,
    })
    await scheduler.initialize(document.createElement('div'))

    await scheduler.renderScene()

    expect(renderer.renderScene).not.toHaveBeenCalled()
    expect(renderChrome).not.toHaveBeenCalled()
    scheduler.dispose()
    secondPreparation.resolve({
      publish: () => ({} as SceneRendererSnapshot),
    })
    await Promise.resolve()
    await Promise.resolve()
  })
})
