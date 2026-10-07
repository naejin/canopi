import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneRendererSnapshot, SceneRenderTarget } from '../renderers/scene-types'
import type { DraftPresentation } from '../tools/draft'
import { createTestSceneRendererSnapshot } from '../../../__tests__/support/scene-renderer-snapshot'
import { SceneRuntimeRenderScheduler } from './render-scheduler'

function createTarget() {
  return {
    setSnapshot: vi.fn<(snapshot: SceneRendererSnapshot) => void>(),
    setDraft: vi.fn<(draft: DraftPresentation | null) => void>(),
    requestRender: vi.fn<() => void>(),
  } satisfies SceneRenderTarget
}

function createScheduler(
  overrides: Partial<ConstructorParameters<typeof SceneRuntimeRenderScheduler>[0]> = {},
): SceneRuntimeRenderScheduler {
  return new SceneRuntimeRenderScheduler({
    prepareSceneRender: async () => ({
      publish: () => createTestSceneRendererSnapshot(),
    }),
    placeOpenedDesign: () => {},
    ...overrides,
  })
}

/** A scheduler mounted on a container with one target connected. */
function mountedScheduler(
  target: SceneRenderTarget = createTarget(),
  overrides: Partial<ConstructorParameters<typeof SceneRuntimeRenderScheduler>[0]> = {},
): SceneRuntimeRenderScheduler {
  const scheduler = createScheduler(overrides)
  scheduler.connect(target)
  scheduler.mount(document.createElement('div'))
  return scheduler
}

const DRAFT: DraftPresentation = {
  shapes: [{ kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 4, y: 3 }], style: { token: 'draft', widthPx: 2 } }],
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

  it('mounts at once and hands each scene render to its one target', async () => {
    const target = createTarget()
    const scheduler = createScheduler()
    const container = document.createElement('div')
    scheduler.connect(target)

    scheduler.mount(container)
    expect(scheduler.container).toBe(container)
    await scheduler.renderScene()

    expect(target.setSnapshot).toHaveBeenCalledOnce()
    expect(() => scheduler.mount(document.createElement('div'))).toThrow('already mounted')
    scheduler.unmount()
  })

  it('a target connected while mounted gets the latest snapshot and draft', async () => {
    const first = createTestSceneRendererSnapshot()
    const latest = createTestSceneRendererSnapshot({ speciesFocus: { canonicalName: 'Malus domestica' } })
    const snapshots = [first, latest]
    const scheduler = createScheduler({ prepareSceneRender: async () => ({ publish: () => snapshots.shift()! }) })
    scheduler.mount(document.createElement('div'))
    // Nothing drawn yet, nothing replayed.
    const early = createTarget()
    scheduler.connect(early)
    expect(early.setSnapshot).not.toHaveBeenCalled()
    expect(early.setDraft).not.toHaveBeenCalled()

    await scheduler.renderScene()
    await scheduler.renderScene()
    scheduler.setDraft(DRAFT)
    // A rebuilt map's layer connects after the Scene drew: it draws the Scene and the live draft with no pan.
    const target = createTarget()
    scheduler.connect(target)

    expect(target.setSnapshot).toHaveBeenCalledExactlyOnceWith(latest)
    expect(target.setDraft).toHaveBeenCalledExactlyOnceWith(DRAFT)
    scheduler.unmount()
  })

  it('a stale disconnect is ignored', async () => {
    const scheduler = createScheduler()
    const first = createTarget()
    const disconnectFirst = scheduler.connect(first)
    const second = createTarget()
    scheduler.connect(second)
    scheduler.mount(document.createElement('div'))

    // The replaced layer's disposal lands after its successor connected.
    disconnectFirst()
    await scheduler.renderScene()
    scheduler.setDraft(DRAFT)

    expect(first.setSnapshot).not.toHaveBeenCalled()
    expect(first.setDraft).not.toHaveBeenCalled()
    expect(second.setSnapshot).toHaveBeenCalledOnce()
    expect(second.setDraft).toHaveBeenCalledExactlyOnceWith(DRAFT)
    scheduler.unmount()
  })

  it('a layer connecting during a Design switch gets nothing of the previous Design, only the opened one once it publishes', async () => {
    const previous = createTestSceneRendererSnapshot()
    const opened = createTestSceneRendererSnapshot({ speciesFocus: { canonicalName: 'Malus domestica' } })
    const species = deferred<void>()
    const snapshots = [previous, opened]
    const scheduler = createScheduler({
      prepareSceneRender: async () => {
        const snapshot = snapshots.shift()!
        if (snapshot === opened) await species.promise
        return { publish: () => snapshot }
      },
    })
    const disconnectOld = scheduler.connect(createTarget())
    scheduler.mount(document.createElement('div'))
    await scheduler.renderScene()
    scheduler.setDraft(DRAFT)

    // Open Design B: the old map's layer disconnects; B's render waits for its species data.
    disconnectOld()
    scheduler.awaitPresentation()
    const rendering = scheduler.renderScene()
    const layer = createTarget()
    scheduler.connect(layer)
    expect(layer.setSnapshot, 'Design A is not drawn at B\'s camera').not.toHaveBeenCalled()
    expect(layer.setDraft).not.toHaveBeenCalled()

    species.resolve()
    await rendering
    expect(layer.setSnapshot).toHaveBeenCalledExactlyOnceWith(opened)
    scheduler.unmount()
  })

  it('a camera frame asks the target for a repaint at once and publishes no snapshot: the layer reads the frame itself', () => {
    const request = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const target = createTarget()
    const scheduler = mountedScheduler(target)

    scheduler.requestRepaint()

    expect(target.requestRender).toHaveBeenCalledOnce()
    expect(target.setSnapshot).not.toHaveBeenCalled()
    expect(request, 'no frame of its own').not.toHaveBeenCalled()
    expect(scheduler.scenePending.value).toBe(false)
    scheduler.unmount()
  })

  it('coalesces scene edits with camera events, and cancels the pending frame on disposal', async () => {
    let frame!: FrameRequestCallback
    const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7 })
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const target = createTarget()
    const scheduler = mountedScheduler(target)
    scheduler.requestRepaint()
    scheduler.invalidate()
    scheduler.invalidate()
    scheduler.requestRepaint()
    await Promise.resolve()
    expect(target.setSnapshot).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledOnce()
    frame(0)
    await vi.waitFor(() => expect(target.setSnapshot).toHaveBeenCalledOnce())
    scheduler.invalidate()
    scheduler.unmount()
    expect(cancel).toHaveBeenCalledWith(7)
  })

  it('unmounts so later invalidations and drafts draw nothing, and a connecting target gets nothing', async () => {
    const request = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const target = createTarget()
    const scheduler = mountedScheduler(target)
    await scheduler.renderScene()
    scheduler.setDraft(DRAFT)
    target.setSnapshot.mockClear()
    target.setDraft.mockClear()
    request.mockClear()

    scheduler.unmount()
    scheduler.invalidate()
    scheduler.requestRepaint()
    scheduler.setDraft(null)
    await scheduler.renderScene()
    const next = createTarget()
    scheduler.connect(next)

    expect(scheduler.container).toBeNull()
    expect(request).not.toHaveBeenCalled()
    expect(target.setSnapshot).not.toHaveBeenCalled()
    expect(target.setDraft).not.toHaveBeenCalled()
    expect(target.requestRender).not.toHaveBeenCalled()
    expect(next.setSnapshot).not.toHaveBeenCalled()
    expect(next.setDraft).not.toHaveBeenCalled()
  })

  it('presents a Design opened while unmounted at once: nothing will draw it until a remount', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const scheduler = mountedScheduler()
    scheduler.unmount()

    scheduler.awaitPresentation()

    expect(scheduler.presented.value).toBe(true)
  })

  it('does not draw a prepared scene after unmount overtakes its preparation', async () => {
    const preparation = deferred<{ publish(): ReturnType<typeof createTestSceneRendererSnapshot> }>()
    const target = createTarget()
    const scheduler = mountedScheduler(target, { prepareSceneRender: () => preparation.promise })

    const render = scheduler.renderScene()
    scheduler.unmount()
    preparation.resolve({ publish: () => createTestSceneRendererSnapshot() })
    await render

    expect(target.setSnapshot).not.toHaveBeenCalled()
  })

  describe('scene render pending state', () => {
    type Preparation = ReturnType<typeof deferred<{ publish(): ReturnType<typeof createTestSceneRendererSnapshot> }>>

    /** Frames run when the test says; each scene render waits for a preparation the test settles. */
    async function createControlledScheduler(target = createTarget()) {
      const frames = new Map<number, FrameRequestCallback>()
      let lastFrame = 0
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        frames.set(++lastFrame, callback)
        return lastFrame
      }))
      vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id) }))
      const preparations: Preparation[] = []
      const scheduler = mountedScheduler(target, {
        prepareSceneRender: () => {
          const preparation: Preparation = deferred()
          preparations.push(preparation)
          return preparation.promise
        },
      })
      const runFrame = () => {
        const [id, callback] = frames.entries().next().value ?? []
        if (id === undefined || !callback) throw new Error('no animation frame is requested')
        frames.delete(id)
        callback(0)
      }
      const prepare = (index: number) => {
        preparations[index]?.resolve({ publish: () => createTestSceneRendererSnapshot() })
      }
      return { scheduler, target, runFrame, prepare, frames }
    }

    it('is pending from a scene invalidation until the frame that draws it has run', async () => {
      const pendingWhenDrawn: boolean[] = []
      const target = {
        ...createTarget(),
        setSnapshot: vi.fn(() => { pendingWhenDrawn.push(scheduler.scenePending.value) }),
      }
      const { scheduler, runFrame, prepare } = await createControlledScheduler(target)
      expect(scheduler.scenePending.value).toBe(false)

      scheduler.invalidate()
      expect(scheduler.scenePending.value).toBe(true)
      runFrame()
      await Promise.resolve()
      expect(scheduler.scenePending.value, 'still pending while the render is prepared').toBe(true)
      prepare(0)

      await vi.waitFor(() => expect(target.setSnapshot).toHaveBeenCalledOnce())
      expect(pendingWhenDrawn).toEqual([true])
      expect(scheduler.scenePending.value, 'MapLibre draws the snapshot in its next frame').toBe(true)
      runFrame()
      expect(scheduler.scenePending.value).toBe(false)
      scheduler.unmount()
    })

    it('stays pending through coalesced invalidations until the latest one is drawn', async () => {
      const { scheduler, target, runFrame, prepare } = await createControlledScheduler()

      scheduler.invalidate()
      scheduler.requestRepaint()
      scheduler.invalidate()
      runFrame()
      // An edit arrives while the first render is prepared: that render is fenced and never draws.
      scheduler.invalidate()
      prepare(0)
      await Promise.resolve()
      await Promise.resolve()
      expect(target.setSnapshot).not.toHaveBeenCalled()
      expect(scheduler.scenePending.value, 'the later edit is not drawn yet').toBe(true)

      runFrame()
      prepare(1)
      await vi.waitFor(() => expect(target.setSnapshot).toHaveBeenCalledOnce())
      runFrame()
      expect(scheduler.scenePending.value).toBe(false)
      scheduler.unmount()
    })

    it('stays pending when an edit made while drawing queues its frame ahead of the older settle frame', async () => {
      let draws = 0
      const target = {
        ...createTarget(),
        // The first draw raises a scene invalidation synchronously, before the scheduler asks
        // for the frame that settles it, so the next render's frame runs first.
        setSnapshot: vi.fn(() => { if (++draws === 1) scheduler.invalidate() }),
      }
      const { scheduler, runFrame, prepare, frames } = await createControlledScheduler(target)

      scheduler.invalidate()
      runFrame()
      prepare(0)
      await vi.waitFor(() => expect(target.setSnapshot).toHaveBeenCalledOnce())
      expect(frames.size, 'the next render frame, then the settle frame of the first render').toBe(2)

      runFrame()
      expect(scheduler.scenePending.value, 'the next render is prepared').toBe(true)
      runFrame()
      expect(scheduler.scenePending.value, 'the older render settling does not end the newer one').toBe(true)

      prepare(1)
      await vi.waitFor(() => expect(target.setSnapshot).toHaveBeenCalledTimes(2))
      expect(scheduler.scenePending.value, 'MapLibre draws the newer snapshot in its next frame').toBe(true)
      runFrame()
      expect(scheduler.scenePending.value).toBe(false)
      scheduler.unmount()
    })

    it('a scene render with an empty slot stays unpresented until a target connects and draws it', async () => {
      const { scheduler, runFrame, prepare, frames } = await createControlledScheduler()
      // A Design switch: the old layer has disconnected and the new one has not connected yet.
      scheduler.connect(createTarget())()
      scheduler.awaitPresentation()

      scheduler.invalidate()
      runFrame()
      prepare(0)
      await Promise.resolve()
      await Promise.resolve()
      while (frames.size > 0) runFrame()
      expect(scheduler.scenePending.value, 'nothing has drawn the scene').toBe(true)
      expect(scheduler.presented.value).toBe(false)

      const layer = createTarget()
      scheduler.connect(layer)
      expect(layer.setSnapshot).toHaveBeenCalledOnce()
      expect(scheduler.presented.value, 'MapLibre draws the snapshot in its next frame').toBe(false)
      runFrame()
      expect(scheduler.scenePending.value).toBe(false)
      expect(scheduler.presented.value).toBe(true)
      scheduler.unmount()
    })

    it('a Design closing settles the render waiting for an empty slot, and later renders into it settle on their frame', async () => {
      const { scheduler, runFrame, prepare, frames } = await createControlledScheduler()
      // Close Design during a switch: the old layer disconnected, the new one never connects.
      scheduler.connect(createTarget())()
      scheduler.awaitPresentation()
      scheduler.invalidate()
      runFrame()
      prepare(0)
      await Promise.resolve()
      await Promise.resolve()
      while (frames.size > 0) runFrame()
      expect(scheduler.scenePending.value, 'the render waits for a layer').toBe(true)

      scheduler.releasePresentation()
      expect(scheduler.scenePending.value, 'no layer will draw it').toBe(false)
      expect(scheduler.presented.value).toBe(true)

      // A theme change on the start screen.
      scheduler.invalidate()
      runFrame()
      prepare(1)
      await Promise.resolve()
      await Promise.resolve()
      expect(scheduler.scenePending.value).toBe(true)
      runFrame()
      expect(scheduler.scenePending.value).toBe(false)
      expect(scheduler.presented.value).toBe(true)
      scheduler.unmount()
    })

    it('is idle once a scene render fails', async () => {
      const failure = new Error('renderer draw failed')
      const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const target = { ...createTarget(), setSnapshot: vi.fn(() => { throw failure }) }
      const { scheduler, runFrame, prepare } = await createControlledScheduler(target)

      scheduler.invalidate()
      runFrame()
      prepare(0)

      await vi.waitFor(() => expect(logError).toHaveBeenCalledWith('Scene Canvas render failed:', failure))
      expect(scheduler.scenePending.value).toBe(false)
      scheduler.unmount()
    })

    it('is idle once the scheduler is disposed with a scene frame pending', async () => {
      const { scheduler, frames } = await createControlledScheduler()

      scheduler.invalidate()
      expect(scheduler.scenePending.value).toBe(true)
      scheduler.unmount()

      expect(frames.size, 'disposal cancels the frame').toBe(0)
      expect(scheduler.scenePending.value).toBe(false)
    })

    it('is idle once the scheduler is disposed while a scene render is prepared', async () => {
      const { scheduler, target, runFrame, prepare } = await createControlledScheduler()

      scheduler.invalidate()
      runFrame()
      expect(scheduler.scenePending.value).toBe(true)
      scheduler.unmount()
      expect(scheduler.scenePending.value).toBe(false)

      prepare(0)
      await Promise.resolve()
      await Promise.resolve()
      expect(target.setSnapshot, 'disposal fences the prepared render').not.toHaveBeenCalled()
      expect(scheduler.scenePending.value).toBe(false)
    })
  })
})
