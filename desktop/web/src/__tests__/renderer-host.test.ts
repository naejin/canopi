import { describe, expect, it, vi } from 'vitest'
import {
  RendererHost,
  RendererHostAlreadyInitializedError,
  RendererHostInitializationCancelledError,
  RendererHostInitializationError,
} from '../canvas/runtime/renderers/host'
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

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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

  it('disposes a backend that finishes initializing after the host is disposed', async () => {
    const pendingBackend = deferred<TestInstance>()
    const lateDispose = vi.fn()
    const fallbackInitialize = vi.fn()
    const onBackendFailure = vi.fn()
    const onBackendChange = vi.fn()
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
          initialize: () => pendingBackend.promise,
        }),
        createBackend('canvas2d', {
          initialize: fallbackInitialize,
        }),
      ],
      onBackendFailure,
      onBackendChange,
    })

    const initialization = host.initialize({ value: 'scene' })
    const disposal = host.dispose()
    pendingBackend.resolve({
      id: 'pixi',
      dispose: lateDispose,
      render: () => 'pixi',
    })

    await expect(initialization).rejects.toBeInstanceOf(RendererHostInitializationCancelledError)
    await disposal
    expect(lateDispose).toHaveBeenCalledTimes(1)
    expect(fallbackInitialize).not.toHaveBeenCalled()
    expect(onBackendFailure).not.toHaveBeenCalled()
    expect(onBackendChange).not.toHaveBeenCalled()
    expect(host.snapshot).toMatchObject({
      initialized: false,
      activeBackendId: null,
      failedBackendIds: [],
      lastError: null,
    })
  })

  it('cancels initialization when backend publication synchronously disposes the host', async () => {
    const dispose = vi.fn()
    let host!: RendererHost<TestContext, TestInstance>
    host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi', {
          initialize: async () => ({
            id: 'pixi',
            dispose,
            render: () => 'pixi',
          }),
        }),
        createBackend('canvas2d'),
      ],
      onBackendChange: () => {
        void host.dispose()
      },
    })

    await expect(host.initialize({ value: 'scene' }))
      .rejects.toBeInstanceOf(RendererHostInitializationCancelledError)
    expect(dispose).toHaveBeenCalledOnce()
    expect(host.snapshot).toMatchObject({
      initialized: false,
      activeBackendId: null,
    })
  })

  it('rolls back an installed backend when change publication throws', async () => {
    const dispose = vi.fn()
    const publicationError = new Error('backend publication failed')
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi', {
          initialize: async () => ({
            id: 'pixi',
            dispose,
            render: () => 'pixi',
          }),
        }),
        createBackend('canvas2d'),
      ],
      onBackendChange: () => {
        throw publicationError
      },
    })

    await expect(host.initialize({ value: 'scene' })).rejects.toBe(publicationError)
    expect(dispose).toHaveBeenCalledOnce()
    expect(host.snapshot).toMatchObject({
      initialized: false,
      activeBackendId: null,
    })
  })

  it('rejects callback-reentrant initialization without replacing the installed backend', async () => {
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    const initialize = vi.fn(async (context: TestContext): Promise<TestInstance> => (
      context.value === 'first'
        ? {
            id: 'pixi',
            dispose: firstDispose,
            render: () => 'first',
          }
        : {
            id: 'pixi',
            dispose: secondDispose,
            render: () => 'second',
          }
    ))
    let reentrantResult: Promise<unknown> | null = null
    let host!: RendererHost<TestContext, TestInstance>
    host = new RendererHost<TestContext, TestInstance>({
      backends: [createBackend('pixi', { initialize }), createBackend('canvas2d')],
      onBackendChange: () => {
        if (reentrantResult) return
        reentrantResult = host.initialize({ value: 'second' }).then(
          () => 'resolved',
          (error: unknown) => error,
        )
      },
    })

    const installed = await host.initialize({ value: 'first' })

    expect(await reentrantResult!).toBeInstanceOf(RendererHostAlreadyInitializedError)
    await expect(host.run((instance) => instance.render())).resolves.toBe('first')
    expect(installed.render()).toBe('first')
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(firstDispose).not.toHaveBeenCalled()
    expect(secondDispose).not.toHaveBeenCalled()
  })

  it('rejects repeated initialization without replacing the active backend', async () => {
    const dispose = vi.fn()
    const initialize = vi.fn(async (context: TestContext): Promise<TestInstance> => ({
      id: 'pixi',
      dispose,
      render: () => context.value,
    }))
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [createBackend('pixi', { initialize }), createBackend('canvas2d')],
    })

    const installed = await host.initialize({ value: 'first' })

    await expect(host.initialize({ value: 'second' }))
      .rejects.toBeInstanceOf(RendererHostAlreadyInitializedError)
    await expect(host.run((instance) => instance.render())).resolves.toBe('first')
    expect(installed.render()).toBe('first')
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('joins pending initialization when run starts before the backend resolves', async () => {
    const pendingBackend = deferred<TestInstance>()
    const initialize = vi.fn(() => pendingBackend.promise)
    const onBackendChange = vi.fn()
    const operation = vi.fn((instance: TestInstance) => instance.render())
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [createBackend('pixi', { initialize }), createBackend('canvas2d')],
      onBackendChange,
    })

    const initialization = host.initialize({ value: 'scene' })
    const run = host.run(operation)

    expect(initialize).toHaveBeenCalledOnce()
    pendingBackend.resolve({
      id: 'pixi',
      dispose: vi.fn(),
      render: () => 'pixi',
    })

    const installed = await initialization
    await expect(run).resolves.toBe('pixi')
    expect(operation).toHaveBeenCalledWith(
      installed,
      expect.objectContaining({ backendId: 'pixi' }),
    )
    expect(initialize).toHaveBeenCalledOnce()
    expect(onBackendChange).toHaveBeenCalledOnce()
  })

  it('joins initialization when a backend initializer reentrantly starts a run', async () => {
    let reentrantRun: Promise<string> | null = null
    let host!: RendererHost<TestContext, TestInstance>
    const initialize = vi.fn((): TestInstance => {
      if (!reentrantRun) {
        reentrantRun = host.run((instance) => instance.render())
      }
      return {
        id: 'pixi',
        dispose: vi.fn(),
        render: () => 'pixi',
      }
    })
    host = new RendererHost<TestContext, TestInstance>({
      backends: [createBackend('pixi', { initialize }), createBackend('canvas2d')],
    })

    const installed = await host.initialize({ value: 'scene' })

    await expect(reentrantRun!).resolves.toBe('pixi')
    expect(installed.render()).toBe('pixi')
    expect(initialize).toHaveBeenCalledOnce()
    expect(host.snapshot.activeBackendId).toBe('pixi')
  })

  it('does not let an outer initializer overwrite a reentrant successor lifecycle', async () => {
    const staleDispose = vi.fn()
    const activeDispose = vi.fn()
    let successorInitialization: Promise<TestInstance> | null = null
    let host!: RendererHost<TestContext, TestInstance>
    const initialize = vi.fn((context: TestContext): TestInstance => {
      if (context.value === 'outer') {
        void host.dispose()
        successorInitialization = host.initialize({ value: 'successor' })
        return {
          id: 'pixi',
          dispose: staleDispose,
          render: () => 'outer',
        }
      }
      return {
        id: 'pixi',
        dispose: activeDispose,
        render: () => context.value,
      }
    })
    host = new RendererHost<TestContext, TestInstance>({
      backends: [createBackend('pixi', { initialize }), createBackend('canvas2d')],
    })

    const outerInitialization = host.initialize({ value: 'outer' })

    await expect(outerInitialization)
      .rejects.toBeInstanceOf(RendererHostInitializationCancelledError)
    await expect(successorInitialization!).resolves.toMatchObject({ id: 'pixi' })
    await expect(host.run((instance) => instance.render())).resolves.toBe('successor')
    expect(initialize).toHaveBeenCalledTimes(2)
    expect(staleDispose).toHaveBeenCalledOnce()
    expect(activeDispose).not.toHaveBeenCalled()
    expect(host.snapshot.activeBackendId).toBe('pixi')
  })

  it('allows reinitialization after disposal while an older initialization is still pending', async () => {
    const firstBackend = deferred<TestInstance>()
    const secondBackend = deferred<TestInstance>()
    const staleDispose = vi.fn()
    const activeDispose = vi.fn()
    let initializationCount = 0
    const initialize = vi.fn(() => {
      initializationCount += 1
      return initializationCount === 1 ? firstBackend.promise : secondBackend.promise
    })
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [createBackend('pixi', { initialize }), createBackend('canvas2d')],
    })

    const staleInitialization = host.initialize({ value: 'stale' })
    await host.dispose()
    const activeInitialization = host.initialize({ value: 'active' })

    firstBackend.resolve({
      id: 'pixi',
      dispose: staleDispose,
      render: () => 'stale',
    })
    await expect(staleInitialization)
      .rejects.toBeInstanceOf(RendererHostInitializationCancelledError)
    await expect(host.initialize({ value: 'competing' }))
      .rejects.toBeInstanceOf(RendererHostAlreadyInitializedError)

    secondBackend.resolve({
      id: 'pixi',
      dispose: activeDispose,
      render: () => 'active',
    })
    await expect(activeInitialization).resolves.toMatchObject({ id: 'pixi' })
    await expect(host.run((instance) => instance.render())).resolves.toBe('active')
    expect(initialize).toHaveBeenCalledTimes(2)
    expect(staleDispose).toHaveBeenCalledOnce()
    expect(activeDispose).not.toHaveBeenCalled()
  })

  it('cancels a run disposed after backend acquisition but before operation invocation', async () => {
    const dispose = vi.fn()
    const operation = vi.fn(() => 'stale operation')
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi', {
          initialize: async () => ({
            id: 'pixi',
            dispose,
            render: () => 'pixi',
          }),
        }),
        createBackend('canvas2d'),
      ],
    })
    await host.initialize({ value: 'scene' })

    const run = host.run(operation)
    const disposal = host.dispose()

    await expect(run).rejects.toBeInstanceOf(RendererHostInitializationCancelledError)
    await disposal
    expect(operation).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not let a stale no-retry failure poison a reinitialized backend', async () => {
    const staleFailure = deferred<void>()
    const operationStarted = deferred<void>()
    const onBackendFailure = vi.fn()
    let initializationCount = 0
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi', {
          initialize: async () => {
            initializationCount += 1
            return {
              id: 'pixi',
              dispose: vi.fn(),
              render: () => `pixi-${initializationCount}`,
            }
          },
        }),
        createBackend('canvas2d'),
      ],
      onBackendFailure,
    })
    await host.initialize({ value: 'first' })
    const staleRun = host.run(async () => {
      operationStarted.resolve()
      await staleFailure.promise
      return 'stale'
    }, {
      retryOnFailover: false,
    })
    await operationStarted.promise

    await host.dispose()
    await host.initialize({ value: 'second' })
    const staleResult = expect(staleRun)
      .rejects.toBeInstanceOf(RendererHostInitializationCancelledError)
    staleFailure.reject(new Error('stale renderer failed'))

    await staleResult
    await expect(host.run((instance) => instance.render())).resolves.toBe('pixi-2')
    expect(onBackendFailure).not.toHaveBeenCalled()
    expect(host.snapshot).toMatchObject({
      initialized: true,
      activeBackendId: 'pixi',
      failedBackendIds: [],
      lastError: null,
    })
  })

  it('does not return a stale operation result after reinitialization', async () => {
    const staleOperation = deferred<string>()
    const operationStarted = deferred<void>()
    let initializationCount = 0
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi', {
          initialize: async () => {
            initializationCount += 1
            return {
              id: 'pixi',
              dispose: vi.fn(),
              render: () => `pixi-${initializationCount}`,
            }
          },
        }),
        createBackend('canvas2d'),
      ],
    })
    await host.initialize({ value: 'first' })
    const staleRun = host.run(async () => {
      operationStarted.resolve()
      return staleOperation.promise
    }, {
      retryOnFailover: false,
    })
    await operationStarted.promise

    await host.dispose()
    await host.initialize({ value: 'second' })
    const staleResult = expect(staleRun)
      .rejects.toBeInstanceOf(RendererHostInitializationCancelledError)
    staleOperation.resolve('stale')

    await staleResult
    await expect(host.run((instance) => instance.render())).resolves.toBe('pixi-2')
  })

  it('does not let a stale retry-stage failure poison a reinitialized backend', async () => {
    const staleRetryFailure = deferred<void>()
    const retryStarted = deferred<void>()
    const onBackendFailure = vi.fn()
    let fallbackInitializationCount = 0
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi'),
        createBackend('canvas2d', {
          initialize: async () => {
            fallbackInitializationCount += 1
            return {
              id: 'canvas2d',
              dispose: vi.fn(),
              render: () => `canvas2d-${fallbackInitializationCount}`,
            }
          },
        }),
      ],
      onBackendFailure,
    })
    await host.initialize({ value: 'first' })
    const staleRun = host.run(async (instance) => {
      if (instance.id === 'pixi') {
        throw new Error('pixi failed')
      }
      retryStarted.resolve()
      await staleRetryFailure.promise
      return 'stale'
    })
    await retryStarted.promise

    await host.dispose()
    await host.initialize({ value: 'second' })
    const staleResult = expect(staleRun)
      .rejects.toBeInstanceOf(RendererHostInitializationCancelledError)
    staleRetryFailure.reject(new Error('stale fallback failed'))

    await staleResult
    await expect(host.run((instance) => instance.render())).resolves.toBe('canvas2d-2')
    expect(onBackendFailure).toHaveBeenCalledTimes(1)
    expect(onBackendFailure).toHaveBeenCalledWith(expect.objectContaining({
      backendId: 'pixi',
      phase: 'runtime',
    }))
    expect(host.snapshot).toMatchObject({
      initialized: true,
      activeBackendId: 'canvas2d',
      failedBackendIds: ['pixi'],
      lastError: null,
    })
  })

  it('does not return a stale retry-stage result after reinitialization', async () => {
    const staleRetry = deferred<string>()
    const retryStarted = deferred<void>()
    let fallbackInitializationCount = 0
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi'),
        createBackend('canvas2d', {
          initialize: async () => {
            fallbackInitializationCount += 1
            return {
              id: 'canvas2d',
              dispose: vi.fn(),
              render: () => `canvas2d-${fallbackInitializationCount}`,
            }
          },
        }),
      ],
    })
    await host.initialize({ value: 'first' })
    const staleRun = host.run(async (instance) => {
      if (instance.id === 'pixi') {
        throw new Error('pixi failed')
      }
      retryStarted.resolve()
      return staleRetry.promise
    })
    await retryStarted.promise

    await host.dispose()
    await host.initialize({ value: 'second' })
    const staleResult = expect(staleRun)
      .rejects.toBeInstanceOf(RendererHostInitializationCancelledError)
    staleRetry.resolve('stale')

    await staleResult
    await expect(host.run((instance) => instance.render())).resolves.toBe('canvas2d-2')
  })

  it('single-flights fallback selection for concurrent failures of one backend', async () => {
    const bothOperationsStarted = deferred<void>()
    const releaseFailures = deferred<void>()
    const pixiDispose = vi.fn()
    const fallbackDisposes: Array<ReturnType<typeof vi.fn>> = []
    let startedOperationCount = 0
    let fallbackCount = 0
    const fallbackInitialize = vi.fn(async (): Promise<TestInstance> => {
      fallbackCount += 1
      const fallbackId = `canvas2d-${fallbackCount}`
      const dispose = vi.fn()
      fallbackDisposes.push(dispose)
      return {
        id: 'canvas2d',
        dispose,
        render: () => fallbackId,
      }
    })
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi', {
          initialize: async () => ({
            id: 'pixi',
            dispose: pixiDispose,
            render: () => 'pixi',
          }),
        }),
        createBackend('canvas2d', { initialize: fallbackInitialize }),
      ],
    })
    await host.initialize({ value: 'scene' })
    const operation = (label: string) => async (instance: TestInstance): Promise<string> => {
      if (instance.id === 'pixi') {
        startedOperationCount += 1
        if (startedOperationCount === 2) {
          bothOperationsStarted.resolve()
        }
        await releaseFailures.promise
        throw new Error(`${label} lost the renderer`)
      }
      return instance.render()
    }

    const firstRun = host.run(operation('first'))
    const secondRun = host.run(operation('second'))
    await bothOperationsStarted.promise
    releaseFailures.resolve()

    await expect(Promise.all([firstRun, secondRun]))
      .resolves.toEqual(['canvas2d-1', 'canvas2d-1'])
    expect(fallbackInitialize).toHaveBeenCalledOnce()
    expect(fallbackDisposes).toHaveLength(1)
    expect(fallbackDisposes[0]).not.toHaveBeenCalled()
    expect(pixiDispose).toHaveBeenCalledOnce()
    expect(host.snapshot.activeBackendId).toBe('canvas2d')
  })

  it('does not dispatch queued work to a backend after failover is admitted', async () => {
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [createBackend('pixi'), createBackend('canvas2d')],
    })
    await host.initialize({ value: 'scene' })
    const failingOperation = vi.fn((instance: TestInstance) => {
      if (instance.id === 'pixi') throw new Error('pixi failed')
      return instance.render()
    })
    const queuedOperation = vi.fn((instance: TestInstance) => instance.render())

    const failoverRun = host.run(failingOperation)
    const queuedRun = host.run(queuedOperation)

    await expect(failoverRun).resolves.toBe('scene:canvas2d')
    await expect(queuedRun).resolves.toBe('scene:canvas2d')
    expect(queuedOperation.mock.calls.map(([instance]) => instance.id))
      .toEqual(['canvas2d'])
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

  it('quarantines every runtime-failed backend and stays exhausted', async () => {
    const pixiDispose = vi.fn()
    const canvasDispose = vi.fn()
    const host = new RendererHost<TestContext, TestInstance>({
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
            dispose: canvasDispose,
            render: () => 'canvas2d',
          }),
        }),
      ],
    })
    await host.initialize({ value: 'scene' })
    const invocationIds: string[] = []

    await expect(host.run((instance) => {
      invocationIds.push(instance.id)
      throw new Error(`${instance.id} runtime failed`)
    }, { operationName: 'render' })).rejects.toBeInstanceOf(
      RendererHostInitializationError,
    )

    expect(invocationIds).toEqual(['pixi', 'canvas2d'])
    expect(pixiDispose).toHaveBeenCalledOnce()
    expect(canvasDispose).toHaveBeenCalledOnce()
    expect(host.snapshot).toMatchObject({
      initialized: false,
      activeBackendId: null,
      failedBackendIds: ['pixi', 'canvas2d'],
    })
    const laterOperation = vi.fn((instance: TestInstance) => instance.render())
    await expect(host.run(laterOperation)).rejects.toBeInstanceOf(
      RendererHostInitializationError,
    )
    expect(laterOperation).not.toHaveBeenCalled()
  })

  it('continues runtime failover through a third backend', async () => {
    const disposals = {
      pixi: vi.fn(),
      canvas2d: vi.fn(),
      fallback: vi.fn(),
    }
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi', {
          initialize: async () => ({
            id: 'pixi',
            dispose: disposals.pixi,
            render: () => 'pixi',
          }),
        }),
        createBackend('canvas2d', {
          initialize: async () => ({
            id: 'canvas2d',
            dispose: disposals.canvas2d,
            render: () => 'canvas2d',
          }),
        }),
        createBackend('fallback', {
          initialize: async () => ({
            id: 'fallback',
            dispose: disposals.fallback,
            render: () => 'fallback',
          }),
        }),
      ],
    })
    await host.initialize({ value: 'scene' })
    const invocationIds: string[] = []

    await expect(host.run((instance) => {
      invocationIds.push(instance.id)
      if (instance.id !== 'fallback') {
        throw new Error(`${instance.id} runtime failed`)
      }
      return instance.render()
    }, { operationName: 'render' })).resolves.toBe('fallback')

    expect(invocationIds).toEqual(['pixi', 'canvas2d', 'fallback'])
    expect(disposals.pixi).toHaveBeenCalledOnce()
    expect(disposals.canvas2d).toHaveBeenCalledOnce()
    expect(disposals.fallback).not.toHaveBeenCalled()
    expect(host.snapshot).toMatchObject({
      initialized: true,
      activeBackendId: 'fallback',
      failedBackendIds: ['pixi', 'canvas2d'],
    })
  })

  it('does not let a failure observer interrupt backend quarantine', async () => {
    const pixiDispose = vi.fn()
    const observerError = new Error('failure observer failed')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = new RendererHost<TestContext, TestInstance>({
      backends: [
        createBackend('pixi', {
          initialize: async () => ({
            id: 'pixi',
            dispose: pixiDispose,
            render: () => 'pixi',
          }),
        }),
        createBackend('canvas2d'),
      ],
      onBackendFailure: () => {
        throw observerError
      },
    })
    await host.initialize({ value: 'scene' })

    try {
      await expect(host.run((instance) => {
        if (instance.id === 'pixi') throw new Error('pixi runtime failed')
        return instance.render()
      })).resolves.toBe('scene:canvas2d')

      expect(pixiDispose).toHaveBeenCalledOnce()
      expect(host.snapshot).toMatchObject({
        initialized: true,
        activeBackendId: 'canvas2d',
        failedBackendIds: ['pixi'],
      })
      expect(logError).toHaveBeenCalledWith(
        'Renderer backend failure observer failed:',
        observerError,
      )
    } finally {
      logError.mockRestore()
    }
  })
})
