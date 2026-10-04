import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneRenderer, SceneRendererDefinition } from '../renderers/scene-types'
import { createTestRendererView, createTestSceneRendererSnapshot } from '../../../__tests__/support/scene-renderer-snapshot'
import {
  SceneRendererMountCancelledError,
  SceneRuntimeRenderScheduler,
} from './render-scheduler'

const VIEW = createTestRendererView({ x: 0, y: 0, scale: 1 })

function createRenderer(): SceneRenderer {
  return {
    id: 'maplibre-pixi',
    syncScene: vi.fn(),
    setView: vi.fn(),
    setDraft: vi.fn(),
    dispose: vi.fn(),
  }
}

function definitionFor(
  renderer: SceneRenderer,
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
    getView: () => VIEW,
    prepareSceneRender: async () => ({
      publish: () => createTestSceneRendererSnapshot(),
    }),
    placeOpenedDesign: () => {},
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
    expect(renderer.syncScene).toHaveBeenCalledOnce()
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
    expect(renderer.syncScene).not.toHaveBeenCalled()
  })

  it('coalesces a burst of camera changes into one frame using the latest viewport', async () => {
    let frame!: FrameRequestCallback
    const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 })
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const renderer = createRenderer()
    let view = createTestRendererView({ x: 0, y: 0, scale: 20 })
    const scheduler = createScheduler(definitionFor(renderer), { getView: () => view })
    await scheduler.initialize(document.createElement('div'))
    for (let i = 0; i < 10; i++) {
      view = createTestRendererView({ x: i, y: i, scale: 20 + i })
      scheduler.invalidate('viewport')
    }
    expect(request).toHaveBeenCalledOnce()
    expect(renderer.setView).not.toHaveBeenCalled()
    frame(0)
    await vi.waitFor(() => expect(renderer.setView).toHaveBeenCalledExactlyOnceWith(view))
    scheduler.dispose()
  })

  it('treats a resize as a camera-only update because MapLibre owns the surface size', async () => {
    const renderer = createRenderer()
    const renderChrome = vi.fn()
    const scheduler = createScheduler(definitionFor(renderer), { renderChrome })
    await scheduler.initialize(document.createElement('div'))

    scheduler.resize(400, 300)

    expect(renderer.setView).toHaveBeenCalledExactlyOnceWith(VIEW)
    expect(renderer.syncScene).not.toHaveBeenCalled()
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
    expect(renderer.syncScene).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledOnce()
    frame(0)
    await vi.waitFor(() => expect(renderer.syncScene).toHaveBeenCalledOnce())
    expect(renderer.setView).not.toHaveBeenCalled()
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
    expect(renderer.syncScene).not.toHaveBeenCalled()
    expect(renderer.setView).not.toHaveBeenCalled()
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

    expect(renderer.syncScene).not.toHaveBeenCalled()
  })

  it('rejects a second mount while one is pending or active', async () => {
    const pendingRenderer = deferred<SceneRenderer>()
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
    const pendingRenderer = deferred<SceneRenderer>()
    const renderer = createRenderer()
    const scheduler = createScheduler(definitionFor(renderer, () => pendingRenderer.promise))

    const initialization = scheduler.initialize(document.createElement('div'))
    scheduler.dispose()
    pendingRenderer.resolve(renderer)

    await expect(initialization).rejects.toBeInstanceOf(SceneRendererMountCancelledError)
    expect(scheduler.container).toBeNull()
    expect(renderer.dispose).toHaveBeenCalledOnce()
  })

  describe('scene render pending state', () => {
    type Preparation = ReturnType<typeof deferred<{ publish(): ReturnType<typeof createTestSceneRendererSnapshot> }>>

    /** Frames run when the test says; each scene render waits for a preparation the test settles. */
    async function createControlledScheduler(renderer = createRenderer()) {
      const frames = new Map<number, FrameRequestCallback>()
      let lastFrame = 0
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        frames.set(++lastFrame, callback)
        return lastFrame
      }))
      vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id) }))
      const preparations: Preparation[] = []
      const scheduler = createScheduler(definitionFor(renderer), {
        prepareSceneRender: () => {
          const preparation: Preparation = deferred()
          preparations.push(preparation)
          return preparation.promise
        },
      })
      await scheduler.initialize(document.createElement('div'))
      const runFrame = () => {
        const [id, callback] = frames.entries().next().value ?? []
        if (id === undefined || !callback) throw new Error('no animation frame is requested')
        frames.delete(id)
        callback(0)
      }
      const prepare = (index: number) => {
        preparations[index]?.resolve({ publish: () => createTestSceneRendererSnapshot() })
      }
      return { scheduler, renderer, runFrame, prepare, frames }
    }

    it('is pending from a scene invalidation until the frame that draws it has run', async () => {
      const pendingWhenDrawn: boolean[] = []
      const renderer = {
        ...createRenderer(),
        syncScene: vi.fn(() => { pendingWhenDrawn.push(scheduler.scenePending.value) }),
      }
      const { scheduler, runFrame, prepare } = await createControlledScheduler(renderer)
      expect(scheduler.scenePending.value).toBe(false)

      scheduler.invalidate('scene')
      expect(scheduler.scenePending.value).toBe(true)
      runFrame()
      await Promise.resolve()
      expect(scheduler.scenePending.value, 'still pending while the render is prepared').toBe(true)
      prepare(0)

      await vi.waitFor(() => expect(renderer.syncScene).toHaveBeenCalledOnce())
      expect(pendingWhenDrawn).toEqual([true])
      expect(scheduler.scenePending.value, 'MapLibre draws the snapshot in its next frame').toBe(true)
      runFrame()
      expect(scheduler.scenePending.value).toBe(false)
      scheduler.dispose()
    })

    it('stays pending through coalesced invalidations until the latest one is drawn', async () => {
      const { scheduler, renderer, runFrame, prepare } = await createControlledScheduler()

      scheduler.invalidate('scene')
      scheduler.invalidate('viewport')
      scheduler.invalidate('scene')
      runFrame()
      // An edit arrives while the first render is prepared: that render is fenced and never draws.
      scheduler.invalidate('scene')
      prepare(0)
      await Promise.resolve()
      await Promise.resolve()
      expect(renderer.syncScene).not.toHaveBeenCalled()
      expect(scheduler.scenePending.value, 'the later edit is not drawn yet').toBe(true)

      runFrame()
      prepare(1)
      await vi.waitFor(() => expect(renderer.syncScene).toHaveBeenCalledOnce())
      runFrame()
      expect(scheduler.scenePending.value).toBe(false)
      scheduler.dispose()
    })

    it('stays pending when an edit made while drawing queues its frame ahead of the older settle frame', async () => {
      let draws = 0
      const renderer = {
        ...createRenderer(),
        // The first draw raises a scene invalidation synchronously, before the scheduler asks
        // for the frame that settles it, so the next render's frame runs first.
        syncScene: vi.fn(() => { if (++draws === 1) scheduler.invalidate('scene') }),
      }
      const { scheduler, runFrame, prepare, frames } = await createControlledScheduler(renderer)

      scheduler.invalidate('scene')
      runFrame()
      prepare(0)
      await vi.waitFor(() => expect(renderer.syncScene).toHaveBeenCalledOnce())
      expect(frames.size, 'the next render frame, then the settle frame of the first render').toBe(2)

      runFrame()
      expect(scheduler.scenePending.value, 'the next render is prepared').toBe(true)
      runFrame()
      expect(scheduler.scenePending.value, 'the older render settling does not end the newer one').toBe(true)

      prepare(1)
      await vi.waitFor(() => expect(renderer.syncScene).toHaveBeenCalledTimes(2))
      expect(scheduler.scenePending.value, 'MapLibre draws the newer snapshot in its next frame').toBe(true)
      runFrame()
      expect(scheduler.scenePending.value).toBe(false)
      scheduler.dispose()
    })

    it('never reports a camera-only frame as a pending scene render', async () => {
      const { scheduler, renderer, runFrame } = await createControlledScheduler()

      scheduler.invalidate('viewport')
      expect(scheduler.scenePending.value).toBe(false)
      runFrame()
      scheduler.resize(400, 300)

      await vi.waitFor(() => expect(renderer.setView).toHaveBeenCalledTimes(2))
      expect(scheduler.scenePending.value).toBe(false)
      scheduler.dispose()
    })

    it('is idle once a scene render fails', async () => {
      const failure = new Error('renderer draw failed')
      const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const renderer = { ...createRenderer(), syncScene: vi.fn(() => { throw failure }) }
      const { scheduler, runFrame, prepare } = await createControlledScheduler(renderer)

      scheduler.invalidate('scene')
      runFrame()
      prepare(0)

      await vi.waitFor(() => expect(logError).toHaveBeenCalledWith('Scene Canvas render failed:', failure))
      expect(scheduler.scenePending.value).toBe(false)
      scheduler.dispose()
    })

    it('is idle once the scheduler is disposed with a scene frame pending', async () => {
      const { scheduler, frames } = await createControlledScheduler()

      scheduler.invalidate('scene')
      expect(scheduler.scenePending.value).toBe(true)
      scheduler.dispose()

      expect(frames.size, 'disposal cancels the frame').toBe(0)
      expect(scheduler.scenePending.value).toBe(false)
    })

    it('is idle once the scheduler is disposed while a scene render is prepared', async () => {
      const { scheduler, renderer, runFrame, prepare } = await createControlledScheduler()

      scheduler.invalidate('scene')
      runFrame()
      expect(scheduler.scenePending.value).toBe(true)
      scheduler.dispose()
      expect(scheduler.scenePending.value).toBe(false)

      prepare(0)
      await Promise.resolve()
      await Promise.resolve()
      expect(renderer.syncScene, 'disposal fences the prepared render').not.toHaveBeenCalled()
      expect(scheduler.scenePending.value).toBe(false)
    })
  })

  it('reports a real failure from a detached resize', async () => {
    const resizeError = new Error('renderer viewport failed')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const renderer = {
      ...createRenderer(),
      setView: () => { throw resizeError },
    }
    const scheduler = createScheduler(definitionFor(renderer))
    await scheduler.initialize(document.createElement('div'))

    scheduler.resize(400, 300)

    await vi.waitFor(() => expect(logError).toHaveBeenCalledOnce())
    expect(logError).toHaveBeenCalledWith('Scene Canvas resize failed:', resizeError)
    scheduler.dispose()
  })
})
