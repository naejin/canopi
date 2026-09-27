import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { librarySnapshot, slopeItem, sourceItem } from './support/library-fixtures'

const actions = vi.hoisted(() => ({
  addToDesign: vi.fn(),
  cancelAnalysisJob: vi.fn().mockResolvedValue(true),
  cancelLibraryImport: vi.fn().mockResolvedValue(undefined),
  chooseImportFiles: vi.fn().mockResolvedValue(null),
  dismissAttachmentFailure: vi.fn(),
  fetchItemSources: vi.fn().mockResolvedValue({ sources: [] }),
  fetchProcessingHistory: vi.fn().mockResolvedValue({ definition_id: 's-def', runs: [], next_cursor: null }),
  moveReference: vi.fn(),
  removeFromDesign: vi.fn(),
  renameLibraryItem: vi.fn().mockResolvedValue(undefined),
  rerunAnalysis: vi.fn().mockResolvedValue(undefined),
  setLidarEntryOpacity: vi.fn(),
  setLidarEntryVisibility: vi.fn(),
}))
const pending = vi.hoisted(() => ({ attachments: null as unknown, failure: null as unknown }))

vi.mock('../app/lidar/actions', async () => {
  const { signal } = await import('@preact/signals')
  pending.attachments = signal([])
  pending.failure = signal(null)
  return { ...actions, pendingAttachments: pending.attachments, attachmentFailure: pending.failure }
})
vi.mock('../ipc/lidar', () => ({
  lidarDisplayDescriptor: vi.fn(() => new Promise(() => {})),
  lidarListLibrary: vi.fn(() => new Promise(() => {})),
  lidarSamplePixel: vi.fn(),
  lidarCancelSamplePixel: vi.fn(),
}))
vi.mock('../app/document-session/store', async () => {
  const { signal } = await import('@preact/signals')
  return {
    currentDesign: signal<unknown>(null),
    designSessionStore: { sessionIdentity: signal('design-a') },
  }
})

import { AddDataMenu, SiteDataInspector, SiteDataRows } from '../components/panels/lidar/SiteData'
import { SiteDataDetails } from '../components/panels/lidar/SiteDataDetails'
import { lidarLibrary } from '../app/lidar/library-store'
import { currentDesign } from '../app/document-session/store'
import { dataDialog, selectSiteRow, siteDataDetails } from '../app/lidar/library-navigation'
import { activeLayerName } from '../app/canvas-settings/signals'
import { sidePanel } from '../app/shell/state'
import { locale } from '../app/settings/state'
import type { Signal } from '@preact/signals'

const library = librarySnapshot

let container: HTMLDivElement
const importGeoJson = vi.fn()

function setDesign(entries: Array<{ kind: 'Source' | 'Derived'; id: string; order: number; visible?: boolean; opacity?: number }>): void {
  (currentDesign as unknown as { value: unknown }).value = {
    lidar: { entries: entries.map((entry) => ({ visible: true, opacity: 1, style: null, ...entry })) },
  }
}

function button(label: string | RegExp, root: ParentNode = container): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((candidate) => {
    const text = `${candidate.textContent ?? ''} ${candidate.getAttribute('aria-label') ?? ''}`.trim()
    return typeof label === 'string' ? text.includes(label) : label.test(text)
  })
  if (!found) throw new Error(`no button ${String(label)}`)
  return found
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function mount(): void {
  act(() => {
    render(<><AddDataMenu importGeoJson={importGeoJson} /><SiteDataRows /><SiteDataInspector /></>, container)
  })
}

function rowNames(): Array<[string | null | undefined, string | undefined]> {
  return Array.from(container.querySelectorAll('li')).map((row) => [
    row.querySelector('strong')?.textContent,
    (row as HTMLElement).dataset.depth,
  ])
}

describe('Layers site data', () => {
  beforeEach(() => {
    locale.value = 'en'
    vi.clearAllMocks()
    sidePanel.value = 'layers'
    activeLayerName.value = 'zones'
    dataDialog.value = null
    siteDataDetails.value = null
    ;(pending.attachments as Signal<unknown[]>).value = []
    ;(pending.failure as Signal<unknown>).value = null
    lidarLibrary.value = library([
      sourceItem('a', 'Ground', { value_range: [100, 200] }),
      sourceItem('b', 'Canopy', { value_range: [0, 24], item_type: { kind: 'Raster', quantity: 'AboveGroundHeight' } }),
      slopeItem('s', 'a'),
    ])
    setDesign([])
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    document.body.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove())
  })

  it('offers files or the Data library to an empty Design', async () => {
    mount()
    expect(container.textContent).toContain('No site data yet')
    await click(button('Open the Data library'))
    expect(dataDialog.value).toEqual({ kind: 'library', focusId: null })
    await click(button('Import files…'))
    expect(actions.chooseImportFiles).toHaveBeenCalledWith('Choose GeoTIFF files', 'GeoTIFF rasters')
  })

  it('adds from files, from the library or through the Data library in one menu', async () => {
    setDesign([{ kind: 'Source', id: 'a', order: 0 }])
    mount()
    await click(button(/^Add data/))
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim()))
      .toEqual(expect.arrayContaining(['Terrain or height from files…', 'From your library', 'Data library…']))
    await click(button('From your library', menu))
    const submenu = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).at(-1)!
    expect(button('Ground · in this Design', submenu).getAttribute('aria-disabled')).toBe('true')
    await click(button('Canopy', submenu))
    expect(actions.addToDesign).toHaveBeenCalledWith('Source', 'b')
    expect(activeLayerName.value).toBe('site:b')
  })

  it('offers Design objects from GeoJSON through the GeoJSON import command', async () => {
    mount()
    await click(button(/^Add data/))
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim()).slice(0, 2))
      .toEqual(['Terrain or height from files…', 'Design objects from GeoJSON…'])
    await click(button('Design objects from GeoJSON…', menu))
    expect(importGeoJson).toHaveBeenCalledOnce()
  })

  it('gathers the outputs of one analysis under a parent row', async () => {
    const output = (id: string, key: string) => slopeItem(id, 'a', {
      provenance: { ...slopeItem(id, 'a').provenance!, definition_id: 'flow-def', output_key: key },
    })
    lidarLibrary.value = library([sourceItem('a', 'Ground'), output('o1', 'slope'), output('o2', 'other'), slopeItem('s', 'a')])
    setDesign([
      { kind: 'Source', id: 'a', order: 0 },
      { kind: 'Derived', id: 'o1', order: 3 },
      { kind: 'Derived', id: 'o2', order: 2 },
      { kind: 'Derived', id: 's', order: 1 },
    ])
    mount()

    expect(rowNames()).toEqual([
      ['Ground', '0'],
      ['Slope', '1'],
      ['Ground · Slope', '2'],
      ['Ground · Slope', '2'],
      ['Ground · Slope', '1'],
    ])
    const parent = container.querySelector<HTMLElement>('[data-analysis-group]')!
    expect(parent.textContent).toContain('from Ground · 2 results')
    // Each output says which one it is; a lone result still says where it comes from.
    const rows = Array.from(container.querySelectorAll('li'))
    expect(rows[2]!.textContent).toContain('Slope · degrees')
    expect(rows[4]!.textContent).toContain('from Ground · degrees')

    await click(button('Hide Slope', parent))
    expect(actions.setLidarEntryVisibility).toHaveBeenCalledWith('o1', false)
    expect(actions.setLidarEntryVisibility).toHaveBeenCalledWith('o2', false)
    expect(actions.setLidarEntryVisibility).not.toHaveBeenCalledWith('s', false)
  })

  it('nests a result under its source and says where it comes from', () => {
    setDesign([
      { kind: 'Source', id: 'a', order: 0 },
      { kind: 'Source', id: 'b', order: 1 },
      { kind: 'Derived', id: 's', order: 2 },
    ])
    mount()
    expect(rowNames()).toEqual([['Canopy', '0'], ['Ground', '0'], ['Ground · Slope', '1']])
    const slope = button('Ground · Slope').closest('li')!
    expect(slope.textContent).toContain('from Ground · degrees')
    expect(button(/^Ground/).closest('li')!.textContent).toContain('Ground elevation · 100.0 – 200.0 m')
  })

  it('shows the active row settings and edits only this Design', async () => {
    setDesign([
      { kind: 'Source', id: 'a', order: 0 },
      { kind: 'Source', id: 'b', order: 1, visible: false },
    ])
    mount()
    expect(container.querySelector('[aria-label="Legend"]')).toBeNull()
    await click(button('Show Canopy'))
    expect(actions.setLidarEntryVisibility).toHaveBeenCalledWith('b', true)

    await click(button(/^Ground/))
    expect(activeLayerName.value).toBe('site:a')
    expect(container.querySelector('[aria-label="Legend"]')).not.toBeNull()
    expect(button('Move Ground forward').disabled).toBe(false)
    expect(button('Move Ground back').disabled).toBe(true)
    await click(button('Move Ground forward'))
    expect(actions.moveReference).toHaveBeenCalledWith('a', 'front')

    await click(button(/^Analyze…$/))
    expect(dataDialog.value).toMatchObject({ kind: 'analyze', itemId: 'a', attach: true })
    await click(button(/^Details$/))
    expect(siteDataDetails.value).toBe('a')

    await click(button('Remove Ground from this Design'))
    expect(actions.removeFromDesign).toHaveBeenCalledWith('a')
    expect(container.textContent).toContain('Your library keeps the data.')
  })

  it('moves a row with Alt and the arrow keys', async () => {
    setDesign([{ kind: 'Source', id: 'a', order: 0 }, { kind: 'Source', id: 'b', order: 1 }])
    mount()
    await act(async () => {
      button(/^Ground/).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))
    })
    expect(actions.moveReference).toHaveBeenCalledWith('a', 'front')
  })

  it('keeps a reference whose library item is gone, labelled unavailable', () => {
    setDesign([{ kind: 'Source', id: 'gone', order: 0 }])
    mount()
    expect(container.textContent).toContain('Unavailable data')
    expect(container.textContent).toContain('Data unavailable')
  })

  it('marks an out-of-date result, says why, and refreshes it in place', async () => {
    lidarLibrary.value = library([
      sourceItem('a', 'Ground'),
      slopeItem('s', 'a', { freshness: { state: 'Stale', reasons: [{ reason: 'InputUpdated', input_key: 'dem', item_id: 'a' }] } }),
    ])
    setDesign([{ kind: 'Derived', id: 's', order: 0 }])
    mount()

    expect(container.querySelector('li')!.textContent).toContain('Out of date')
    await click(button('Refresh Ground · Slope'))
    expect(actions.rerunAnalysis).toHaveBeenCalledWith('s-def')

    await act(async () => { selectSiteRow('s') })
    expect(container.textContent).toContain('Ground has changed since this was calculated.')
    expect(container.querySelector('[aria-label="Legend"]')?.textContent).toContain('60.0°')
  })

  it('shows a refresh in progress instead of offering another', () => {
    lidarLibrary.value = library([
      sourceItem('a', 'Ground'),
      slopeItem('s', 'a', {
        freshness: { state: 'Stale', reasons: [{ reason: 'RecipeUpdated', from: 1, to: 2 }] },
        run: { job_id: 'j', state: 'Preparing', message: null },
      }),
    ])
    setDesign([{ kind: 'Derived', id: 's', order: 0 }])
    mount()
    expect(container.textContent).toContain('Refreshing')
    expect(() => button('Refresh Ground · Slope')).toThrow()
  })

  it('shows imports and calculations joining this Design, with Cancel', async () => {
    lidarLibrary.value = library([
      sourceItem('a', 'Ground'),
      sourceItem('n', 'North tiles', {
        state: 'Preparing', generation_id: null,
        import_job: { job_id: 'job-n', layer_id: 'n', state: 'Applying', message: null, progress: { phase: 'RenderingMap', percent: 62 } },
      }),
      slopeItem('r', 'a', { name: 'Terrace', state: 'Preparing', generation_id: null, run: { job_id: 'job-r', state: 'Preparing', message: null } }),
    ])
    ;(pending.attachments as Signal<unknown[]>).value = [
      { key: 'import:n', kind: 'import', identity: 'design-a', itemIds: ['n'] },
      { key: 'r-def', kind: 'analysis', identity: 'design-a', itemIds: ['r'] },
      { key: 'import:other', kind: 'import', identity: 'design-b', itemIds: ['a'] },
    ]
    setDesign([{ kind: 'Source', id: 'a', order: 0 }])
    mount()
    const importing = container.querySelector<HTMLElement>('[role="group"][aria-label="North tiles"]')!
    expect(importing.textContent).toContain('Importing · 62%')
    expect(importing.textContent).toContain('You can keep working.')
    await click(button('Cancel import', importing))
    expect(actions.cancelLibraryImport).toHaveBeenCalledWith('job-n')
    const calculating = container.querySelector<HTMLElement>('[role="group"][aria-label="Terrace"]')!
    await click(button('Cancel calculation', calculating))
    expect(actions.cancelAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'r' }))
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(2)
  })

  it('says when work started here could not join the Design', async () => {
    ;(pending.failure as Signal<unknown>).value = { itemId: 'a', message: 'not a raster' }
    mount()
    expect(container.textContent).toContain('Ground could not be added to this Design: not a raster')
    await click(button('Show in the Data library'))
    expect(actions.dismissAttachmentFailure).toHaveBeenCalled()
    expect(dataDialog.value).toEqual({ kind: 'library', focusId: 'a' })
  })
})

describe('Layers site data details', () => {
  beforeEach(() => {
    locale.value = 'en'
    vi.clearAllMocks()
    dataDialog.value = null
    lidarLibrary.value = library([
      sourceItem('a', 'Ground'),
      slopeItem('s', 'a', {
        name: 'Steepness',
        freshness: { state: 'Stale', reasons: [{ reason: 'InputUpdated', input_key: 'dem', item_id: 'a' }] },
      }),
    ])
    container = document.createElement('div')
    document.body.append(container)
    siteDataDetails.value = 's'
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    siteDataDetails.value = null
  })

  it('shows provenance, staleness with Refresh, history and Run again with changes', async () => {
    act(() => { render(<SiteDataDetails id="s" />, container) })
    await act(async () => {})
    expect(container.querySelector('h2')?.textContent).toBe('Steepness')
    expect(container.textContent).toContain('Ground has changed since this was calculated.')
    expect(container.querySelector('dl')?.textContent).toContain('Calculated fromGround')
    expect(actions.fetchProcessingHistory).toHaveBeenCalledWith('s-def', null)

    await click(button('Refresh Steepness'))
    expect(actions.rerunAnalysis).toHaveBeenCalledWith('s-def')
    await click(button('Run again with changes…'))
    expect(dataDialog.value).toMatchObject({ kind: 'analyze', itemId: 'a', analysisId: 'terrain.slope', from: 's', attach: true })

    await click(button(/^Ground$/))
    expect(siteDataDetails.value).toBe('a')
  })

  it('renames in place and goes back to Layers', async () => {
    act(() => { render(<SiteDataDetails id="s" />, container) })
    await click(button('Rename…'))
    const input = container.querySelector<HTMLInputElement>('input[name="name"]')!
    input.value = 'Orchard slope'
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(actions.renameLibraryItem).toHaveBeenCalledWith('s', 'Orchard slope')
    await click(button('Back to Layers'))
    expect(siteDataDetails.value).toBeNull()
  })

  it('opens the Data library for deleting', async () => {
    act(() => { render(<SiteDataDetails id="s" />, container) })
    await click(button('Open in the Data library'))
    expect(dataDialog.value).toEqual({ kind: 'library', focusId: 's' })
  })
})
