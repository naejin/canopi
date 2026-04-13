import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocationSearchController } from '../app/location'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('location search controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('debounces geocoding and exposes mapped results', async () => {
    const geocode = vi.fn().mockResolvedValue([
      { display_name: 'Paris, France', lat: 48.8566, lon: 2.3522 },
    ])
    const controller = createLocationSearchController({ debounceMs: 300, geocode })

    controller.setQuery('pa')
    expect(geocode).not.toHaveBeenCalled()
    expect(controller.showDropdown.value).toBe(false)

    controller.setQuery('paris')
    expect(controller.isSearching.value).toBe(true)
    expect(geocode).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    await flushMicrotasks()

    expect(geocode).toHaveBeenCalledWith('paris')
    expect(controller.isSearching.value).toBe(false)
    expect(controller.showDropdown.value).toBe(true)
    expect(controller.results.value).toEqual([
      { displayName: 'Paris, France', lat: 48.8566, lon: 2.3522 },
    ])
  })

  it('ignores stale geocode responses after a newer query supersedes them', async () => {
    const first = createDeferred<Array<{ display_name: string; lat: number; lon: number }>>()
    const second = createDeferred<Array<{ display_name: string; lat: number; lon: number }>>()
    const geocode = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const controller = createLocationSearchController({ debounceMs: 300, geocode })

    controller.setQuery('paris')
    vi.advanceTimersByTime(300)

    controller.setQuery('berlin')
    vi.advanceTimersByTime(300)

    first.resolve([{ display_name: 'Paris, France', lat: 48.8566, lon: 2.3522 }])
    await flushMicrotasks()
    expect(controller.results.value).toEqual([])

    second.resolve([{ display_name: 'Berlin, Germany', lat: 52.52, lon: 13.405 }])
    await flushMicrotasks()

    expect(controller.results.value).toEqual([
      { displayName: 'Berlin, Germany', lat: 52.52, lon: 13.405 },
    ])
    expect(controller.query.value).toBe('berlin')
  })

  it('surfaces geocode failures as a translated error key', async () => {
    const geocode = vi.fn().mockRejectedValue(new Error('boom'))
    const controller = createLocationSearchController({ debounceMs: 300, geocode })

    controller.setQuery('paris')
    vi.advanceTimersByTime(300)
    await flushMicrotasks()

    expect(controller.errorKey.value).toBe('canvas.location.geocodeError')
    expect(controller.showDropdown.value).toBe(true)
    expect(controller.isSearching.value).toBe(false)
  })

  it('invalidates in-flight results when the dropdown is closed', async () => {
    const deferredRequest = createDeferred<Array<{ display_name: string; lat: number; lon: number }>>()
    const geocode = vi.fn().mockReturnValue(deferredRequest.promise)
    const controller = createLocationSearchController({ debounceMs: 300, geocode })

    controller.setQuery('paris')
    vi.advanceTimersByTime(300)
    controller.closeDropdown()

    deferredRequest.resolve([{ display_name: 'Paris, France', lat: 48.8566, lon: 2.3522 }])
    await flushMicrotasks()

    expect(controller.showDropdown.value).toBe(false)
    expect(controller.results.value).toEqual([])
    expect(controller.isSearching.value).toBe(false)
  })

  it('clears active state when a result is consumed or the controller is disposed', () => {
    const controller = createLocationSearchController({ debounceMs: 300, geocode: vi.fn() })

    controller.setQuery('paris')
    controller.consumeResult()

    expect(controller.query.value).toBe('')
    expect(controller.results.value).toEqual([])
    expect(controller.showDropdown.value).toBe(false)

    controller.setQuery('berlin')
    controller.dispose()
    vi.runOnlyPendingTimers()

    expect(controller.isSearching.value).toBe(false)
  })
})
