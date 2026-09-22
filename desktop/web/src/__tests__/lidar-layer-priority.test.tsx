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
import { lidarStatusMessage } from '../app/lidar/library-store'
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
  async function openHistory(): Promise<void> {
    await mount()
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Layer actions"]')
    expect(trigger).not.toBeNull()
    await act(() => trigger?.click())
    const item = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'))
      .find((button) => button.textContent === 'History')
    expect(item).toBeDefined()
    await act(() => item?.click())
    await flush()
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
})
