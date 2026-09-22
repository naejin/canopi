import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchLayerCollection = vi.hoisted(() => vi.fn())
const fetchLayerHistory = vi.hoisted(() => vi.fn())
const moveLayerSource = vi.hoisted(() => vi.fn())
const removeLayerSource = vi.hoisted(() => vi.fn())
const undoLayerChange = vi.hoisted(() => vi.fn())
const restoreLayerVersion = vi.hoisted(() => vi.fn())

vi.mock('../app/lidar/actions', () => ({
  fetchLayerCollection,
  fetchLayerHistory,
  moveLayerSource,
  removeLayerSource,
  undoLayerChange,
  restoreLayerVersion,
  analyseLayerAsSlope: vi.fn(),
  applyOpenImport: vi.fn(),
  cancelOpenImport: vi.fn(),
  createLidarLayer: vi.fn(),
  deleteLidarAnalysis: vi.fn(),
  deleteLidarLayer: vi.fn(),
  fetchLidarLayerDeleteImpact: vi.fn(),
  setLidarEntryOpacity: vi.fn(),
  setLidarEntryVisibility: vi.fn(),
  startImportForLayer: vi.fn(),
}))

vi.mock('../app/lidar/library-store', async () => {
  const { signal } = await import('@preact/signals')
  return {
    lidarLibrary: signal({
      layers: [
        {
          id: 'layer-1',
          name: 'Ground',
          measurement_kind: 'GroundElevation',
          units: 'm',
          state: 'Ready',
          resolution_m: 1,
          coverage_cells: '6',
          bounds: [0, 0, 1, 1],
          value_range: [0, 100],
          tilesets: [],
          analysis_count: 0,
        },
      ],
      analyses: [],
      engine: { available: true, version: '3.8', detail: null },
    }),
    lidarStatusMessage: signal<string | null>(null),
    openImportJob: signal(null),
    readLidarPresentation: () => [
      { id: 'layer-1', kind: 'Source', name: 'Ground', visible: true, opacity: 1, state: 'ready', detail: '', bounds: [0, 0, 1, 1], tilesets: [] },
    ],
    dismissTrackedImport: vi.fn(),
    hideTrackedImport: vi.fn(),
    showTrackedImport: vi.fn(),
  }
})

vi.mock('../app/document-session/store', () => ({
  currentDesign: { value: null },
}))

vi.mock('../app/settings/state', () => ({ locale: { value: 'en' } }))

vi.mock('../app/lidar/camera-request', () => ({
  lidarMapViewBounds: { value: null },
  viewDesignLocation: vi.fn(),
  viewLidarCoverage: vi.fn(),
}))

import { locale } from '../app/settings/state'
import { lidarLibrary, lidarStatusMessage } from '../app/lidar/library-store'
import { LidarLayersSection } from '../components/panels/lidar/LidarLayersSection'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const SOURCE = (memberId: string, filename: string | null, kind = 'source') => ({
  member_id: memberId,
  kind,
  filename,
  interpretation_id: kind === 'source' ? `interp-${memberId}` : null,
  base_generation_id: kind === 'source' ? null : 'gen-legacy',
  width: 1,
  height: 1,
  pixel_size_m: 1,
  coverage_cells: '1',
  value_range: [0, 1],
})

const COLLECTION = (overrides: Record<string, unknown> = {}) => ({
  layer_id: 'layer-1',
  head_generation_id: 'gen-2',
  member_count: 2,
  undo_available: true,
  undo_target: 'gen-1',
  sources: [
    SOURCE('mem-top', 'mnt-north.tif'),
    SOURCE('mem-legacy', null, 'previous-composition'),
  ],
  next_member_cursor: null,
  ...overrides,
})

const HISTORY = (overrides: Record<string, unknown> = {}) => ({
  layer_id: 'layer-1',
  head_generation_id: 'gen-2',
  versions: [
    { id: 'gen-2', created_at: '2', coverage_cells: '2', sequence: 2, operation: 'reorder', source_count: 2, is_head: true, restorable: false },
    { id: 'gen-1', created_at: '1', coverage_cells: '1', sequence: 1, operation: null, source_count: 1, is_head: false, restorable: true },
  ],
  next_cursor: null,
  ...overrides,
})

describe('ordered layer priority panel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    locale.value = 'en'
    lidarStatusMessage.value = null
    container = document.createElement('div')
    document.body.append(container)
    fetchLayerCollection.mockResolvedValue(COLLECTION())
    fetchLayerHistory.mockResolvedValue(HISTORY())
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  /** Let every pending microtask and effect settle. */
  async function flush(): Promise<void> {
    for (let turn = 0; turn < 6; turn += 1) {
      await act(() => Promise.resolve())
    }
  }

  async function mount(): Promise<void> {
    await act(() => render(<LidarLayersSection />, container))
    await flush()
  }

  /** The row's action menu is portalled to the document body. */
  async function openHistoryView(): Promise<void> {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Layer actions"]')
    expect(trigger).not.toBeNull()
    await act(() => trigger?.click())
    const item = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'))
      .find((button) => button.textContent === 'History')
    expect(item).toBeDefined()
    await act(() => item?.click())
    await flush()
  }

  async function openHistory(): Promise<void> {
    await mount()
    await openHistoryView()
  }

  /** Refresh the library signal without touching the IPC mocks. */
  async function refreshLibrary(): Promise<void> {
    await act(() => { lidarLibrary.value = { ...lidarLibrary.value! } })
    await flush()
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent === label)
  }

  function moveUps(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Move up"]'))
  }

  it('shows the stored source filename instead of a digest', async () => {
    await mount()
    expect(container.textContent).toContain('mnt-north.tif')
    expect(container.textContent).toContain('Previous composition')
  })

  it('disables the priority controls while an edit is pending', async () => {
    const pending = deferred<unknown>()
    moveLayerSource.mockReturnValue(pending.promise)
    await mount()

    const ups = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Move up"]'))
    // The topmost source cannot move up; the one below it can.
    expect(ups()[0]?.disabled).toBe(true)
    expect(ups()[1]?.disabled).toBe(false)
    await act(() => ups()[1]?.click())

    const downWhilePending = container.querySelector<HTMLButtonElement>('button[aria-label="Move down"]')
    expect(downWhilePending?.disabled).toBe(true)
    expect(ups()[1]?.disabled).toBe(true)

    await act(async () => {
      pending.resolve({ head_generation_id: 'gen-3', changed: true, message: null })
      await pending.promise
    })
    await flush()
    expect(ups()[1]?.disabled).toBe(false)
  })

  it('keeps a failed edit message visible and re-reads the head', async () => {
    moveLayerSource.mockRejectedValueOnce(new Error('the layer changed since this edit was prepared'))
    await mount()

    const ups = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Move up"]'))
    await act(() => ups[1]?.click())
    await flush()

    expect(container.textContent).toContain('the layer changed since this edit was prepared')
    expect(fetchLayerCollection.mock.calls.length).toBeGreaterThan(1)
  })

  it('appends the next member page and keeps the first page order', async () => {
    fetchLayerCollection
      .mockResolvedValueOnce(COLLECTION({ member_count: 3, next_member_cursor: 'gen-2:1' }))
      .mockResolvedValueOnce(
        COLLECTION({
          member_count: 3,
          sources: [SOURCE('mem-oldest', 'older.tif')],
          next_member_cursor: null,
        }),
      )
    await mount()

    const loadMore = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Load more sources')
    expect(loadMore).toBeDefined()
    await act(() => loadMore?.click())
    await flush()

    expect(container.textContent).toContain('mnt-north.tif')
    expect(container.textContent).toContain('older.tif')
  })

  it('names a version without a recorded operation neutrally and cues each version', async () => {
    await openHistory()
    expect(container.textContent).toContain('Reorder')
    expect(container.textContent).toContain('Previous version')
    expect(container.textContent).toContain('#1')
    expect(container.textContent).toContain('#2')
  })

  it('disables Undo when the walk is exhausted', async () => {
    fetchLayerCollection.mockResolvedValue(
      COLLECTION({ undo_available: false, undo_target: null }),
    )
    await openHistory()
    const undo = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Undo last change')
    expect(undo?.disabled).toBe(true)
    expect(container.textContent).toContain('There is no earlier version to undo.')
  })

  it('settles a pending edit after the view moves on', async () => {
    const edit = deferred<unknown>()
    moveLayerSource.mockReturnValue(edit.promise)
    await mount()
    await act(() => moveUps()[1]?.click())
    expect(moveUps()[1]?.disabled).toBe(true)

    // Navigating to History must not orphan the pending state the edit owns.
    await openHistoryView()
    await act(async () => {
      edit.resolve({ head_generation_id: 'gen-3', changed: true, message: null })
      await edit.promise
    })
    await flush()

    expect(button('Undo last change')?.disabled).toBe(false)
  })

  it('settles a rejected edit after the view moves on and keeps its message', async () => {
    const edit = deferred<unknown>()
    moveLayerSource.mockReturnValue(edit.promise)
    await mount()
    await act(() => moveUps()[1]?.click())
    await openHistoryView()

    await act(async () => {
      edit.reject(new Error('the layer changed since this edit was prepared'))
      await edit.promise.catch(() => undefined)
    })
    await flush()

    // The named refusal stays visible and the controls the edit disabled are
    // usable again, so the user can retry against the head that was re-read.
    expect(container.textContent).toContain('the layer changed since this edit was prepared')
    expect(button('Undo last change')?.disabled).toBe(false)
    expect(fetchLayerCollection.mock.calls.length).toBeGreaterThan(1)
  })

  it('keeps the refreshed head when an older same-layer read answers late', async () => {
    const older = deferred<unknown>()
    fetchLayerCollection.mockReturnValueOnce(older.promise)
    await mount()

    fetchLayerCollection.mockResolvedValue(
      COLLECTION({ head_generation_id: 'gen-new', sources: [SOURCE('mem-new', 'new.tif')] }),
    )
    await refreshLibrary()
    expect(container.textContent).toContain('new.tif')

    await act(async () => {
      older.resolve(
        COLLECTION({ head_generation_id: 'gen-old', sources: [SOURCE('mem-old', 'old.tif')] }),
      )
      await older.promise
    })
    await flush()

    expect(container.textContent).toContain('new.tif')
    expect(container.textContent).not.toContain('old.tif')
  })

  it('keeps the refreshed history when an older same-layer read answers late', async () => {
    const older = deferred<unknown>()
    fetchLayerHistory.mockReturnValueOnce(older.promise)
    await openHistory()

    fetchLayerHistory.mockResolvedValue(HISTORY({
      head_generation_id: 'gen-3',
      versions: [
        { id: 'gen-3', created_at: '3', coverage_cells: '3', sequence: 9, operation: 'remove', source_count: 1, is_head: true, restorable: false },
      ],
    }))
    await refreshLibrary()
    expect(container.textContent).toContain('#9')

    await act(async () => {
      older.resolve(HISTORY({
        versions: [
          { id: 'gen-old', created_at: '0', coverage_cells: '1', sequence: 7, operation: 'import', source_count: 1, is_head: true, restorable: false },
        ],
      }))
      await older.promise
    })
    await flush()

    expect(container.textContent).toContain('#9')
    expect(container.textContent).not.toContain('#7')
  })

  it('does not append a page from a superseded traversal after a refresh', async () => {
    fetchLayerCollection.mockResolvedValueOnce(COLLECTION({ next_member_cursor: 'gen-2:1' }))
    await mount()

    const page = deferred<unknown>()
    fetchLayerCollection.mockReturnValueOnce(page.promise)
    await act(() => button('Load more sources')?.click())
    expect(button('Load more sources')?.disabled).toBe(true)

    fetchLayerCollection.mockResolvedValue(
      COLLECTION({ head_generation_id: 'gen-new', sources: [SOURCE('mem-new', 'new.tif')] }),
    )
    await refreshLibrary()
    expect(container.textContent).toContain('new.tif')

    await act(async () => {
      page.resolve(COLLECTION({
        head_generation_id: 'gen-2',
        sources: [SOURCE('mem-older', 'older.tif')],
      }))
      await page.promise
    })
    await flush()

    expect(container.textContent).not.toContain('older.tif')
    // The refreshed head has no further page, and the old traversal's rows are
    // gone rather than mixed into the new list.
    expect(button('Load more sources')).toBeUndefined()
    expect(container.textContent).not.toContain('mnt-north.tif')
  })

  it('keeps History actions disabled until their own read settles', async () => {
    const historyPage = deferred<unknown>()
    fetchLayerHistory.mockReturnValueOnce(historyPage.promise)
    await openHistory()

    // The summary is loaded and Undo is available, but the version page the
    // view is built on has not answered yet.
    expect(container.textContent).toContain('Loading history')
    expect(button('Undo last change')?.disabled).toBe(true)

    await act(async () => {
      historyPage.resolve(HISTORY())
      await historyPage.promise
    })
    await flush()

    expect(button('Undo last change')?.disabled).toBe(false)
  })
})
