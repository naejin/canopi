import { describe, expect, it } from 'vitest'
import {
  acquireCanvasRuntimeLifecycle,
  CanvasRuntimeLifecycleBusyError,
  type CanvasRuntimeLifecycleLease,
} from './lifecycle-owner'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('Canvas runtime lifecycle owner', () => {
  it('holds the owner until its asynchronous release settles', async () => {
    const release = deferred<void>()
    const first = await acquireCanvasRuntimeLifecycle(() => release.promise)
    const firstRelease = first.release()

    const successor = acquireCanvasRuntimeLifecycle(async () => undefined)
    let successorSettled = false
    void successor.then(() => { successorSettled = true })
    await Promise.resolve()

    expect(successorSettled).toBe(false)
    release.resolve()
    await firstRelease
    await expect(successor).resolves.toEqual(expect.objectContaining({ release: expect.any(Function) }))
    const second = await successor
    await second.release()
  })

  it('rejects an acquisition while an unreleased owner is live', async () => {
    const first = await acquireCanvasRuntimeLifecycle(async () => undefined)

    await expect(acquireCanvasRuntimeLifecycle(async () => undefined))
      .rejects.toBeInstanceOf(CanvasRuntimeLifecycleBusyError)

    await first.release()
  })

  it('retains a failed release and retries it for a later successor', async () => {
    let attempts = 0
    const first = await acquireCanvasRuntimeLifecycle(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('handoff failed')
    })

    await expect(first.release()).rejects.toThrow('handoff failed')
    const successor = await acquireCanvasRuntimeLifecycle(async () => undefined)
    expect(attempts).toBe(2)
    await successor.release()
  })

  it('shares a repeated release attempt', async () => {
    const release = deferred<void>()
    let calls = 0
    const lease = await acquireCanvasRuntimeLifecycle(() => {
      calls += 1
      return release.promise
    })

    const firstRelease = lease.release()
    const secondRelease = lease.release()
    expect(secondRelease).toBe(firstRelease)
    expect(calls).toBe(1)
    release.resolve()
    await firstRelease
  })

  it('publishes the shared release before synchronous cleanup reenters acquisition', async () => {
    const release = deferred<void>()
    let calls = 0
    let successor: Promise<CanvasRuntimeLifecycleLease> | null = null
    const first = await acquireCanvasRuntimeLifecycle(() => {
      calls += 1
      successor = acquireCanvasRuntimeLifecycle(async () => undefined)
      return release.promise
    })

    const firstRelease = first.release()
    expect(calls).toBe(1)
    release.resolve()
    await firstRelease

    const next = await successor!
    expect(calls).toBe(1)
    await next.release()
  })

  it('allows only one continuation to claim after a shared predecessor release', async () => {
    const release = deferred<void>()
    const first = await acquireCanvasRuntimeLifecycle(() => release.promise)
    void first.release()

    const firstSuccessor = acquireCanvasRuntimeLifecycle(async () => undefined)
    const secondSuccessor = acquireCanvasRuntimeLifecycle(async () => undefined)
    release.resolve()

    const results = await Promise.allSettled([firstSuccessor, secondSuccessor])
    const acquired = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(acquired).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CanvasRuntimeLifecycleBusyError)
    await (acquired[0] as PromiseFulfilledResult<Awaited<typeof firstSuccessor>>).value.release()
  })
})
