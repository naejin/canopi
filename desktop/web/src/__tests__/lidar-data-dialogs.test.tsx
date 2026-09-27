import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItemSummary, LibrarySnapshot } from '../generated/contracts'
import { librarySnapshot, slopeItem, sourceItem } from './support/library-fixtures'

const actions = vi.hoisted(() => ({
  addToDesign: vi.fn(),
  runAnalysis: vi.fn().mockResolvedValue({ definition_id: 'adef-new', job_id: 'job', item_ids: ['new'] }),
  rerunAnalysis: vi.fn().mockResolvedValue({ definition_id: 'adef', job_id: 'job', item_ids: [] }),
  cancelAnalysisJob: vi.fn().mockResolvedValue(true),
  fetchProcessingHistory: vi.fn(),
  cancelLibraryImport: vi.fn().mockResolvedValue(undefined),
  chooseImportFiles: vi.fn(),
  deleteLibraryItem: vi.fn().mockResolvedValue(undefined),
  dismissLibraryImport: vi.fn().mockResolvedValue(undefined),
  fetchDeleteImpact: vi.fn(),
  fetchItemSources: vi.fn().mockResolvedValue({ sources: [] }),
  importLibraryItem: vi.fn().mockResolvedValue({ layer_id: 'new', job_id: 'job' }),
  renameLibraryItem: vi.fn().mockResolvedValue(undefined),
  retryLibraryImport: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../app/shell/modal-layer', () => ({
  holdModalLayer: () => () => {},
  registerModalInertRegion: () => () => {},
}))

vi.mock('../app/lidar/actions', () => actions)

vi.mock('../app/lidar/library-store', async () => {
  const { signal } = await import('@preact/signals')
  return {
    ...(await vi.importActual<typeof import('../app/lidar/library-store')>('../app/lidar/library-store')),
    installLidarLibraryObserver: () => () => {},
    lidarLibrary: signal<LibrarySnapshot | null>(null),
    lidarStatusMessage: signal<string | null>(null),
  }
})

vi.mock('../app/document-session/store', async () => {
  const { signal } = await import('@preact/signals')
  return { currentDesign: signal<unknown>(null) }
})

vi.mock('../components/panels/lidar/LibraryPreview', () => ({
  usePreviewClient: () => null,
  LibraryPreview: () => <span data-preview="true" />,
}))

import { DataDialogs } from '../components/panels/lidar/DataDialogs'
import { lidarLibrary } from '../app/lidar/library-store'
import { currentDesign } from '../app/document-session/store'
import { analyzeItem, dataDialog, openDataLibrary } from '../app/lidar/library-navigation'
import { activeLayerName } from '../app/canvas-settings/signals'
import { sidePanel } from '../app/shell/state'
import { locale } from '../app/settings/state'
import { dropdownTrigger } from './support/dropdown-trigger'

function layer(id: string, name: string, overrides: Partial<LibraryItemSummary> = {}): LibraryItemSummary {
  return sourceItem(id, name, { resolution_m: 0.5, value_range: [1, 2], ...overrides })
}

function slope(id: string, source: string, overrides: Partial<LibraryItemSummary> = {}): LibraryItemSummary {
  return slopeItem(id, source, { value_range: [0, 30], ...overrides })
}

function library(layers: LibraryItemSummary[], analyses: LibraryItemSummary[] = []): LibrarySnapshot {
  return librarySnapshot([...layers, ...analyses])
}

function design(entries: { kind: 'Source' | 'Derived'; id: string }[]) {
  return { lidar: { entries: entries.map((entry, order) => ({ ...entry, order, visible: true, opacity: 1 })) } }
}

let container: HTMLDivElement

function setDesign(value: unknown): void {
  (currentDesign as unknown as { value: unknown }).value = value
}

function button(text: string | RegExp): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((candidate) => {
    const label = `${candidate.textContent ?? ''} ${candidate.getAttribute('aria-label') ?? ''}`.trim()
    return typeof text === 'string' ? label.includes(text) : text.test(label)
  })
  if (!found) throw new Error(`no button ${String(text)}`)
  return found
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function chooseFrom(label: string, option: string): Promise<void> {
  const trigger = dropdownTrigger(container, label)
  if (!trigger) throw new Error(`no ${label} dropdown`)
  await click(trigger)
  const item = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    .find((candidate) => candidate.textContent === option)
  if (!item) throw new Error(`no ${option} option`)
  await click(item)
}

function mount(): void {
  act(() => {
    openDataLibrary()
    render(<DataDialogs />, container)
  })
}

async function focusItem(id: string): Promise<void> {
  await act(async () => { openDataLibrary(id) })
}

function title(): string | null | undefined {
  return container.querySelector('h2')?.textContent
}

describe('Data library, Import and Analyze dialogs', () => {
  beforeEach(() => {
    locale.value = 'en'
    vi.clearAllMocks()
    lidarLibrary.value = library([])
    setDesign(design([]))
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    dataDialog.value = null
  })

  it('offers import from an empty library and creates nothing when the chooser is cancelled', async () => {
    actions.chooseImportFiles.mockResolvedValue(null)
    mount()
    expect(container.textContent).toContain('No data yet')
    expect(container.textContent).toContain('IGN LiDAR HD')
    await click(button(/^Import…$/))

    expect(actions.chooseImportFiles).toHaveBeenCalledTimes(1)
    expect(actions.importLibraryItem).not.toHaveBeenCalled()
    expect(dataDialog.value?.kind).toBe('library')
  })

  it('requires a measurement, then imports the files in order into the library only', async () => {
    actions.chooseImportFiles.mockResolvedValue(['/d/tile_02.tif', '/d/tile_01.tif'])
    mount()
    await click(button(/^Import…$/))

    expect(title()).toBe('Import terrain or height data')
    expect(container.textContent).toContain('Single-band GeoTIFF rasters.')
    const submit = button('Import 2 files')
    expect(submit.disabled).toBe(true)
    expect(container.textContent).toContain('the first file in the list wins')
    await click(button('Move tile_01.tif up'))
    expect(Array.from(container.querySelectorAll('ol li > span:first-child')).map((row) => row.textContent)).toEqual(['tile_01.tif', 'tile_02.tif'])
    expect(container.querySelector('select')).toBeNull()
    expect(dropdownTrigger(container, 'What the values measure')?.textContent).toContain('Choose a measurement')
    await chooseFrom('What the values measure', 'Ground elevation')
    expect(submit.disabled).toBe(false)
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(actions.importLibraryItem).toHaveBeenCalledWith(
      ['/d/tile_01.tif', '/d/tile_02.tif'], 'tile_0', 'GroundElevation', { label: null, unknown: false }, false)
    expect(actions.addToDesign).not.toHaveBeenCalled()
    // Started from the library, Import returns to it.
    expect(dataDialog.value).toEqual({ kind: 'library', focusId: null })
  })

  it('refuses a name the library already uses and suggests a free one', async () => {
    lidarLibrary.value = library([layer('a', 'Terrain')])
    act(() => {
      dataDialog.value = { kind: 'import', paths: ['/d/one.tif'], attach: true, returnTo: null }
      render(<DataDialogs />, container)
    })
    const name = container.querySelector<HTMLInputElement>('input[required]')!
    await act(async () => {
      name.value = 'terrain'
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await chooseFrom('What the values measure', 'Ground elevation')
    expect(container.textContent).toContain('already has data named “terrain”')
    expect(container.textContent).toContain('“terrain (2)”')
    expect(button('Import 1 file').disabled).toBe(true)
    expect(container.textContent).toContain('added to this Design when it is ready')
  })

  it('adds a ready item to the Design and marks items the Design already uses', async () => {
    lidarLibrary.value = library([layer('a', 'Ground'), layer('b', 'Canopy')])
    setDesign(design([{ kind: 'Source', id: 'b' }]))
    mount()

    // The rows already show how many items there are; the header carries no bare count.
    expect(container.querySelector('header')?.textContent).not.toMatch(/\d/)
    expect(container.querySelector('footer')?.textContent).toContain('2 items')

    const canopy = button('Canopy').closest('li')!
    expect(canopy.textContent).toContain('In this Design')
    expect(canopy.querySelector('[aria-label="Add Canopy to this Design"]')).toBeNull()
    await click(button('Add Ground to this Design'))
    expect(actions.addToDesign).toHaveBeenCalledWith('Source', 'a')
  })

  it('offers Retry and Dismiss for a failed import', async () => {
    lidarLibrary.value = library([layer('x', 'Broken', {
      generation_id: null, state: 'Failed',
      import_job: { job_id: 'job-x', layer_id: 'x', state: 'Failed', message: 'unreadable file', progress: null },
    })])
    mount()

    expect(container.textContent).toContain('unreadable file')
    await click(button('Retry'))
    await click(button('Dismiss'))
    expect(actions.retryLibraryImport).toHaveBeenCalledWith('x')
    expect(actions.dismissLibraryImport).toHaveBeenCalledWith('x')
  })

  it('nests results under the data they were calculated from', () => {
    lidarLibrary.value = library([layer('a', 'Ground'), layer('b', 'Canopy')], [slope('s', 'a')])
    mount()
    const rows = Array.from(container.querySelectorAll('li')).map((row) => [row.querySelector('strong')?.textContent, row.dataset.nested])
    expect(rows).toEqual([['Canopy', 'false'], ['Ground', 'false'], ['Ground · Slope', 'true']])
  })

  it('filters by analysis group from the registry', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a')])
    mount()
    expect(container.querySelector('select')).toBeNull()
    await click(dropdownTrigger(container, 'Type')!)
    expect(Array.from(container.querySelectorAll('[role="option"]')).map((option) => option.textContent))
      .toEqual(['All types', 'Imported data', 'Terrain'])
    await click(dropdownTrigger(container, 'Type')!)
    await chooseFrom('Type', 'Terrain')
    expect(dropdownTrigger(container, 'Type')?.textContent).toContain('Terrain')
    expect(Array.from(container.querySelectorAll('li strong')).map((node) => node.textContent)).toEqual(['Ground · Slope'])
  })

  it('refuses to delete an item other results use and can show those results', async () => {
    lidarLibrary.value = library([layer('a', 'Ground', { dependents: 1 }), layer('b', 'Canopy')], [slope('s', 'a')])
    actions.fetchDeleteImpact.mockResolvedValue({ dependent_item_ids: ['s'] })
    mount()
    await click(button('Actions for Ground'))
    await click(document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="Delete from library"]')!)

    expect(actions.fetchDeleteImpact).toHaveBeenCalledWith('a')
    expect(container.textContent).toContain('Saved results depend on this data (1)')
    expect(() => button(/^Delete everywhere$/)).toThrow()
    await click(button('Show results'))

    const names = Array.from(container.querySelectorAll('li strong')).map((node) => node.textContent)
    expect(names).toEqual(['Ground · Slope'])
    expect(actions.deleteLibraryItem).not.toHaveBeenCalled()
  })

  it('deletes a result by its item id', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a', { name: 'Steepness' })])
    actions.fetchDeleteImpact.mockResolvedValue({ dependent_item_ids: [] })
    mount()
    await click(button('Actions for Steepness'))
    await click(document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="Delete from library"]')!)
    await click(button(/^Delete everywhere$/))
    expect(actions.deleteLibraryItem).toHaveBeenCalledWith('s')
  })

  it('retries a failed calculation by rerunning its definition', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a', {
      generation_id: null, state: 'Failed', name: 'Steepness', run: { job_id: 'j', state: 'Failed', message: 'engine stopped' },
    })])
    mount()
    await focusItem('s')

    expect(container.querySelector('h3')?.textContent).toBe('Steepness')
    expect(container.textContent).toContain('engine stopped')
    await click(button(/^Retry$/))
    expect(actions.rerunAnalysis).toHaveBeenCalledWith('s-def')
  })

  async function openAnalyze(name: string): Promise<void> {
    await click(button(`Actions for ${name}`))
    await click(document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="Analyze…"]')!)
  }

  async function choose(label: string): Promise<void> {
    const input = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .find((candidate) => candidate.closest('label')?.textContent?.includes(label))!
    await act(async () => { input.click() })
  }

  async function submit(): Promise<void> {
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  }

  it('runs slope from a source as a new library result, once a unit is chosen', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')])
    mount()
    await openAnalyze('Ground')

    expect(title()).toBe('Analyze Ground')
    expect(container.textContent).toContain('saved to your library')
    const name = container.querySelector<HTMLInputElement>('form input:not([type])')!
    expect(name.value).toBe('Ground · Slope')
    await submit()
    expect(actions.runAnalysis).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Choose an option.')

    await choose('Percent')
    await submit()
    expect(actions.runAnalysis).toHaveBeenCalledWith({
      analysis_id: 'terrain.slope',
      inputs: [{ key: 'dem', item_id: 'a' }],
      parameters: [{ key: 'unit', value: { Choice: 'percent' } }],
      outputs: ['slope'],
      name: 'Ground · Slope',
    }, false)
    await act(async () => {})
    expect(dataDialog.value).toEqual({ kind: 'library', focusId: null })
  })

  it('explains by name why an analysis cannot run', async () => {
    lidarLibrary.value = library([
      layer('s', 'Canopy', {
        item_type: { kind: 'Raster', quantity: 'SurfaceElevation' },
        offers: [{ analysis_id: 'terrain.slope', unavailable: { reason: 'WrongInput', expected: [{ kind: 'Raster', quantity: 'GroundElevation' }] } }],
      }),
      layer('g', 'Ground', { offers: [{ analysis_id: 'terrain.slope', unavailable: { reason: 'EngineMissing', detail: 'not installed' } }] }),
    ])
    mount()
    await openAnalyze('Canopy')
    expect(container.textContent).toContain('Needs Ground elevation.')
    expect(button(/^Run$/).disabled).toBe(true)

    await click(button(/^Cancel$/))
    await openAnalyze('Ground')
    expect(container.textContent).toContain('Unavailable: the GeoLibre engine is missing. (not installed)')
    expect(button(/^Run$/).disabled).toBe(true)
    expect(actions.runAnalysis).not.toHaveBeenCalled()
  })

  it('attaches a Layers-initiated analysis to the asking Design', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')])
    mount()
    await act(async () => { analyzeItem('a', { attach: true, analysisId: 'terrain.slope' }) })
    expect(container.textContent).toContain('added under it in Layers')
    await choose('Degrees')
    await submit()
    expect(actions.runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ analysis_id: 'terrain.slope' }), true)
  })

  it('shows a result the Design already has in Layers instead of calculating it again', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a')])
    setDesign(design([{ kind: 'Derived', id: 's' }]))
    mount()
    await openAnalyze('Ground')
    await choose('Degrees')
    expect(container.textContent).toContain('Already in Layers.')
    await click(button('Show in Layers'))
    expect(sidePanel.value).toBe('layers')
    expect(activeLayerName.value).toBe('site:s')
    expect(dataDialog.value).toBeNull()
    expect(actions.runAnalysis).not.toHaveBeenCalled()
  })

  it('offers an existing library result before calculating a duplicate', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a')])
    mount()
    await openAnalyze('Ground')
    await choose('Degrees')
    expect(container.textContent).toContain('already in the library')
    await click(button('Add existing'))
    expect(actions.addToDesign).toHaveBeenCalledWith('Derived', 's')
    expect(actions.runAnalysis).not.toHaveBeenCalled()
  })

  it('runs a result again with changes as a new analysis prefilled from its provenance', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a', { name: 'Steepness' })])
    mount()
    await click(button('Actions for Steepness'))
    await click(document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="Run again with changes…"]')!)

    expect(title()).toBe('Analyze Ground')
    const degrees = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .find((candidate) => candidate.closest('label')?.textContent === 'Degrees')!
    expect(degrees.checked).toBe(true)
    // The same settings are still a new calculation, never a refresh.
    await choose('Percent')
    await submit()
    expect(actions.runAnalysis).toHaveBeenCalledWith({
      analysis_id: 'terrain.slope',
      inputs: [{ key: 'dem', item_id: 'a' }],
      parameters: [{ key: 'unit', value: { Choice: 'percent' } }],
      outputs: ['slope'],
      name: 'Ground · Slope',
    }, false)
    expect(actions.rerunAnalysis).not.toHaveBeenCalled()
  })

  it('offers no run with changes once the input is gone', async () => {
    lidarLibrary.value = library([], [slope('s', 'a', { name: 'Steepness' })])
    mount()
    await click(button('Actions for Steepness'))
    expect(document.querySelector('[role="menu"] [aria-label="Run again with changes…"]')).toBeNull()
  })

  it('describes a result by its provenance', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('new', 'a', { name: 'New' })])
    mount()
    await focusItem('new')
    const facts = container.querySelector('dl')!.textContent
    expect(facts).toContain('AnalysisSlope · Version 1')
    expect(facts).toContain('UnitDegrees')
    expect(facts).toContain('Calculated fromGround')
    expect(facts).toContain('geolibre-cli 1.5.3 (aac2b7439786)')
    await click(button(/^Ground$/))
    expect(container.querySelector('h3')?.textContent).toBe('Ground')
  })

  it('marks an out-of-date result with its reasons and refreshes it', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a', {
      name: 'Steepness',
      freshness: { state: 'Stale', reasons: [
        { reason: 'InputUpdated', input_key: 'dem', item_id: 'a' },
        { reason: 'ToolUpdated', from: 'geolibre-cli 1.5.2', to: 'geolibre-cli 1.5.3' },
      ] },
    })])
    mount()
    const row = button('Steepness').closest('li')!
    expect(row.textContent).toContain('Out of date')
    await click(button('Refresh Steepness'))
    expect(actions.rerunAnalysis).toHaveBeenCalledWith('s-def')

    await focusItem('s')
    expect(container.textContent).toContain('Ground has changed since this was calculated.')
    expect(container.textContent).toContain('A different engine build is installed (geolibre-cli 1.5.3).')
  })

  it('shows processing history with a result and pages it', async () => {
    const run = (job: string) => ({
      job_id: job, state: 'Complete' as const, message: null, recipe_version: 1, tool: null, inputs: [],
      created_at: '1790000000000', finished_at: null, outputs: [{ item_id: 's', generation_id: 'g', coverage_cells: '1200' }],
    })
    actions.fetchProcessingHistory
      .mockResolvedValueOnce({ definition_id: 's-def', runs: [run('j2')], next_cursor: 'c1' })
      .mockResolvedValueOnce({ definition_id: 's-def', runs: [{ ...run('j1'), state: 'Failed', message: 'engine stopped', outputs: [] }], next_cursor: null })
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a', { name: 'Steepness' })])
    mount()
    await focusItem('s')
    await act(async () => {})
    expect(actions.fetchProcessingHistory).toHaveBeenCalledWith('s-def', null)
    const history = container.querySelector('section[aria-label="Processing history"]')!
    expect(history.textContent).toContain('Completed')
    expect(history.textContent).toContain('1,200 cells published')
    await act(async () => {})

    await click(button('Show more'))
    await act(async () => {})
    expect(actions.fetchProcessingHistory).toHaveBeenLastCalledWith('s-def', 'c1')
    expect(history.querySelectorAll('li')).toHaveLength(2)
    expect(history.textContent).toContain('engine stopped')
    expect(history.textContent).toContain('Nothing published')
    expect(() => button('Show more')).toThrow()
  })

  it('offers Cancel for a running calculation and cancels its job', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a', {
      generation_id: null, state: 'Preparing', name: 'Pending', run: { job_id: 'job-1', state: 'Preparing', message: null },
    })])
    mount()
    expect(container.textContent).toContain('Calculating')
    await click(button(/^Cancel calculation$/))
    expect(actions.cancelAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({ id: 's', run: expect.objectContaining({ job_id: 'job-1' }) }))
  })

  it('labels a cancelled calculation as cancelled, not failed', () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [
      slope('c', 'a', { generation_id: null, state: 'Failed', name: 'Stopped', run: { job_id: 'j', state: 'Cancelled', message: null } }),
    ])
    mount()
    const row = button('Stopped').closest('li')!
    expect(row.textContent).toContain('Cancelled')
    expect(row.textContent).not.toContain('Calculation failed')
  })
})
