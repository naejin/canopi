import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarAnalysisSummary, LidarLayerSummary, LidarLibrarySnapshot } from '../generated/contracts'

const actions = vi.hoisted(() => ({
  addToDesign: vi.fn(),
  cancelLibraryImport: vi.fn().mockResolvedValue(undefined),
  chooseImportFiles: vi.fn(),
  deleteLibraryItem: vi.fn().mockResolvedValue(undefined),
  dismissLibraryImport: vi.fn().mockResolvedValue(undefined),
  fetchDeleteImpact: vi.fn(),
  fetchItemSources: vi.fn().mockResolvedValue({ sources: [] }),
  importLibraryItem: vi.fn().mockResolvedValue({ layer_id: 'new', job_id: 'job' }),
  renameLibraryItem: vi.fn().mockResolvedValue(undefined),
  retryFailedCalculation: vi.fn().mockResolvedValue(undefined),
  retryLibraryImport: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../app/lidar/actions', () => actions)

vi.mock('../app/lidar/library-store', async () => {
  const { signal } = await import('@preact/signals')
  return {
    installLidarLibraryObserver: () => () => {},
    lidarLibrary: signal<LidarLibrarySnapshot | null>(null),
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

import { DataLibraryPanel } from '../components/panels/lidar/DataLibraryPanel'
import { lidarLibrary } from '../app/lidar/library-store'
import { currentDesign } from '../app/document-session/store'
import { libraryFocusRequest } from '../app/lidar/library-navigation'
import { locale } from '../app/settings/state'

function layer(id: string, name: string, overrides: Partial<LidarLayerSummary> = {}): LidarLayerSummary {
  return {
    id, name, generation_id: `${id}-g1`, measurement_kind: 'GroundElevation', units: 'm', state: 'Ready',
    resolution_m: 0.5, coverage_cells: null, bounds: [0, 0, 1, 1], value_range: [1, 2], display_range: null, analysis_count: 0, import_job: null, ...overrides,
  }
}

function slope(id: string, source: string, overrides: Partial<LidarAnalysisSummary> = {}): LidarAnalysisSummary {
  return {
    id, generation_id: `${id}-g1`, input_generation_id: `${source}-g1`, source_layer_id: source, kind: 'Slope',
    name: null, state: 'Ready', detail: null, bounds: [0, 0, 1, 1], value_range: [0, 30], slope_unit: 'Degrees', ...overrides,
  } as LidarAnalysisSummary
}

function library(layers: LidarLayerSummary[], analyses: LidarAnalysisSummary[] = []): LidarLibrarySnapshot {
  return { layers, analyses, engine: { available: true, version: null, detail: null } }
}

function design(entries: { kind: 'Source' | 'Analysis'; id: string }[]) {
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

function mount(): void {
  act(() => {
    render(<DataLibraryPanel />, container)
  })
}

describe('Data Library panel', () => {
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
  })

  it('offers import from an empty library and creates nothing when the chooser is cancelled', async () => {
    actions.chooseImportFiles.mockResolvedValue(null)
    mount()
    await click(button('Import data'))

    expect(actions.chooseImportFiles).toHaveBeenCalledTimes(1)
    expect(actions.importLibraryItem).not.toHaveBeenCalled()
    expect(container.querySelector('form')).toBeNull()
  })

  it('requires a measurement, then imports the files in order into the library only', async () => {
    actions.chooseImportFiles.mockResolvedValue(['/d/tile_02.tif', '/d/tile_01.tif'])
    mount()
    await click(button('Import data'))

    const submit = button('Import files (2)')
    expect(submit.disabled).toBe(true)
    expect(container.textContent).toContain('the first file in the list wins')
    const select = container.querySelector('form select') as HTMLSelectElement
    await act(async () => {
      select.value = 'GroundElevation'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(submit.disabled).toBe(false)
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(actions.importLibraryItem).toHaveBeenCalledWith(
      ['/d/tile_02.tif', '/d/tile_01.tif'], 'tile_0', 'GroundElevation', { label: null, unknown: false })
    expect(actions.addToDesign).not.toHaveBeenCalled()
    expect(container.querySelector('form')).toBeNull()
  })

  it('adds a ready item to the Design and marks items the Design already uses', async () => {
    lidarLibrary.value = library([layer('a', 'Ground'), layer('b', 'Canopy')])
    setDesign(design([{ kind: 'Source', id: 'b' }]))
    mount()

    expect(button('Canopy is in this Design').disabled).toBe(true)
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

  it('refuses to delete a source with saved results and can show those results', async () => {
    lidarLibrary.value = library([layer('a', 'Ground', { analysis_count: 1 }), layer('b', 'Canopy')], [slope('s', 'a')])
    actions.fetchDeleteImpact.mockResolvedValue({ layer_name: 'Ground', analysis_count: 1, analysis_ids: ['s'] })
    mount()
    await click(button('Actions for Ground'))
    await click(document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="Delete from library"]')!)

    expect(container.textContent).toContain('Saved results depend on this data (1)')
    expect(() => button(/^Delete from library$/)).toThrow()
    await click(button('Show results'))

    const names = Array.from(container.querySelectorAll('li strong')).map((node) => node.textContent)
    expect(names).toEqual(['Ground · Slope'])
    expect(actions.deleteLibraryItem).not.toHaveBeenCalled()
  })

  it('retries a failed calculation with its saved input', async () => {
    lidarLibrary.value = library([layer('a', 'Ground')], [slope('s', 'a', {
      generation_id: null, state: 'Failed', detail: 'engine stopped', name: 'Steepness',
    })])
    mount()
    await act(async () => {
      libraryFocusRequest.value = 's'
    })

    expect(container.querySelector('h3')?.textContent).toBe('Steepness')
    await click(button(/^Retry$/))
    expect(actions.retryFailedCalculation).toHaveBeenCalledWith('s', 'a-g1')
  })
})
