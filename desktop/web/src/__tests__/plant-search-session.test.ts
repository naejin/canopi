import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPlantSearchSession,
  type PlantSearchAdapter,
} from '../app/plant-browser/search-session'
import type { PaginatedResult, SpeciesListItem } from '../types/species'

function makePlant(canonicalName: string): SpeciesListItem {
  return {
    canonical_name: canonicalName,
    slug: canonicalName.toLowerCase().replace(/\s+/g, '-'),
    common_name: canonicalName,
    common_name_2: null,
    matched_common_name: null,
    is_name_fallback: false,
    family: null,
    genus: null,
    height_max_m: null,
    hardiness_zone_min: null,
    hardiness_zone_max: null,
    growth_rate: null,
    stratum: null,
    climate_zones: [],
    life_cycles: [],
    edibility_rating: null,
    medicinal_rating: null,
    width_max_m: null,
    is_favorite: false,
  }
}

function page(
  names: string[],
  nextCursor: string | null,
  totalEstimate: number,
): PaginatedResult<SpeciesListItem> {
  return {
    items: names.map(makePlant),
    next_cursor: nextCursor,
    total_estimate: totalEstimate,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('plant search session', () => {
  it('debounces text changes before issuing a first-page request', async () => {
    vi.useFakeTimers()
    const locale = signal('en')
    const search = vi.fn(async (..._args: Parameters<PlantSearchAdapter>) => page([], null, 0))
    const session = createPlantSearchSession({ search, locale })
    const dispose = session.start()

    await flushMicrotasks()
    expect(search).toHaveBeenCalledTimes(1)

    search.mockClear()
    session.setText('a')
    session.setText('al')
    await flushMicrotasks()

    expect(session.results.value.status).toBe('loading-first-page')
    expect(search).not.toHaveBeenCalled()

    vi.advanceTimersByTime(149)
    await flushMicrotasks()
    expect(search).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await flushMicrotasks()

    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      text: 'al',
      filters: expect.any(Object),
      cursor: null,
      limit: 50,
      sort: 'Relevance',
      locale: 'en',
      include_total: false,
    }))

    dispose()
  })

  it('clears results for one-character normalized text without hitting backend search', async () => {
    vi.useFakeTimers()
    const locale = signal('en')
    const search = vi.fn<PlantSearchAdapter>()
      .mockResolvedValueOnce(page(['Initial row'], null, 42))
    const session = createPlantSearchSession({ search, locale })
    const dispose = session.start()

    await flushMicrotasks()
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Initial row'])

    search.mockClear()
    session.setText(' é ')
    await flushMicrotasks()

    expect(session.results.value.status).toBe('loading-first-page')
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Initial row'])

    vi.advanceTimersByTime(150)
    await flushMicrotasks()

    expect(search).not.toHaveBeenCalled()
    expect(session.results.value.status).toBe('idle')
    expect(session.results.value.items).toEqual([])
    expect(session.results.value.nextCursor).toBeNull()
    expect(session.results.value.totalEstimate).toBe(0)
    expect(session.results.value.committedRevision).toBe(2)

    dispose()
  })

  it('keeps exact counts for empty browse and omits them for active text searches', async () => {
    vi.useFakeTimers()
    const locale = signal('en')
    const search = vi.fn<PlantSearchAdapter>()
      .mockResolvedValueOnce(page(['Browse row'], null, 42))
      .mockResolvedValueOnce(page(['Search row'], 'offset:50', 0))
    const session = createPlantSearchSession({ search, locale })
    const dispose = session.start()

    await flushMicrotasks()
    expect(search).toHaveBeenNthCalledWith(1, expect.objectContaining({
      text: '',
      filters: expect.any(Object),
      cursor: null,
      limit: 50,
      sort: 'Name',
      locale: 'en',
      include_total: true,
    }))
    expect(session.results.value.totalEstimate).toBe(42)

    session.setText('al')
    vi.advanceTimersByTime(150)
    await flushMicrotasks()

    expect(search).toHaveBeenNthCalledWith(2, expect.objectContaining({
      text: 'al',
      filters: expect.any(Object),
      cursor: null,
      limit: 50,
      sort: 'Relevance',
      locale: 'en',
      include_total: false,
    }))
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Search row'])
    expect(session.results.value.totalEstimate).toBe(0)

    dispose()
  })

  it('keeps active text on relevance ordering and browse on canonical-name ordering', async () => {
    vi.useFakeTimers()
    const locale = signal('en')
    const search = vi.fn<PlantSearchAdapter>()
      .mockResolvedValue(page([], null, 0))
    const session = createPlantSearchSession({ search, locale })
    const dispose = session.start()

    await flushMicrotasks()
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      text: '',
      filters: expect.any(Object),
      cursor: null,
      limit: 50,
      sort: 'Name',
      locale: 'en',
      include_total: true,
    }))

    session.setText('lin')
    vi.advanceTimersByTime(150)
    await flushMicrotasks()
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      text: 'lin',
      filters: expect.any(Object),
      cursor: null,
      limit: 50,
      sort: 'Relevance',
      locale: 'en',
      include_total: false,
    }))

    session.setText('')
    vi.advanceTimersByTime(150)
    await flushMicrotasks()
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      text: '',
      filters: expect.any(Object),
      cursor: null,
      limit: 50,
      sort: 'Name',
      locale: 'en',
      include_total: true,
    }))

    dispose()
  })

  it('ignores stale first-page responses while keeping committed rows visible', async () => {
    const locale = signal('en')
    const stale = deferred<PaginatedResult<SpeciesListItem>>()
    const fresh = deferred<PaginatedResult<SpeciesListItem>>()
    const search = vi.fn<PlantSearchAdapter>()
      .mockResolvedValueOnce(page(['Initial row'], null, 1))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise)
    const session = createPlantSearchSession({ search, locale })
    const dispose = session.start()

    await flushMicrotasks()
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Initial row'])
    expect(session.results.value.committedRevision).toBe(1)

    session.patchFilters({ woody: true })
    await flushMicrotasks()
    expect(session.results.value.status).toBe('loading-first-page')
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Initial row'])

    session.patchFilters({ edible: true })
    await flushMicrotasks()
    expect(search).toHaveBeenCalledTimes(3)

    stale.resolve(page(['Stale row'], null, 1))
    await flushMicrotasks()
    expect(session.results.value.status).toBe('loading-first-page')
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Initial row'])
    expect(session.results.value.committedRevision).toBe(1)

    fresh.resolve(page(['Fresh row'], null, 1))
    await flushMicrotasks()
    expect(session.results.value.status).toBe('idle')
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Fresh row'])
    expect(session.results.value.committedRevision).toBe(2)

    dispose()
  })

  it('appends pagination without advancing the committed first-page revision', async () => {
    const locale = signal('en')
    const search = vi.fn<PlantSearchAdapter>()
      .mockResolvedValueOnce(page(['First row'], 'offset:50', 42))
      .mockResolvedValueOnce(page(['Second row'], null, 0))
      .mockResolvedValueOnce(page(['Replacement row'], null, 7))
    const session = createPlantSearchSession({ search, locale })
    const dispose = session.start()

    await flushMicrotasks()
    expect(session.results.value.committedRevision).toBe(1)
    expect(session.results.value.totalEstimate).toBe(42)

    await session.loadNextPage()

    expect(search).toHaveBeenNthCalledWith(2, expect.objectContaining({
      text: '',
      filters: expect.any(Object),
      cursor: 'offset:50',
      limit: 50,
      sort: 'Name',
      locale: 'en',
      include_total: false,
    }))
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual([
      'First row',
      'Second row',
    ])
    expect(session.results.value.committedRevision).toBe(1)
    expect(session.results.value.totalEstimate).toBe(42)

    session.retry()
    await flushMicrotasks()

    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Replacement row'])
    expect(session.results.value.committedRevision).toBe(2)
    expect(session.results.value.totalEstimate).toBe(7)

    dispose()
  })

  it('preserves visible stale items when a replacement search errors', async () => {
    const locale = signal('en')
    const search = vi.fn<PlantSearchAdapter>()
      .mockResolvedValueOnce(page(['Committed row'], 'offset:50', 1))
      .mockRejectedValueOnce(new Error('backend unavailable'))
    const session = createPlantSearchSession({ search, locale })
    const dispose = session.start()

    await flushMicrotasks()
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Committed row'])

    session.patchFilters({ woody: true })
    await flushMicrotasks()

    expect(session.results.value.status).toBe('error')
    expect(session.results.value.error).toBe('backend unavailable')
    expect(session.results.value.items.map((item) => item.canonical_name)).toEqual(['Committed row'])
    expect(session.results.value.committedRevision).toBe(1)

    dispose()
  })
})
