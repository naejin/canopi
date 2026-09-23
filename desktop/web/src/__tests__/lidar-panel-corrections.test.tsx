import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signal } from '@preact/signals'

/**
 * The corrections an independent review found in the Desktop surfaces.
 *
 * Each case drives the production component rather than a helper, because the
 * review's findings were all of the form "the panel never shows what the action
 * produced" — a shape that a helper-level test cannot see.
 */

const analyseLayerAsSlope = vi.hoisted(() => vi.fn())
const cancelAnalysisJob = vi.hoisted(() => vi.fn())
const startImportForLayer = vi.hoisted(() => vi.fn())
const removePresentationEntry = vi.hoisted(() => vi.fn())

vi.mock('../app/lidar/actions', () => ({
  analyseLayerAsSlope,
  cancelAnalysisJob,
  runningAnalysisJobId: () => null,
  startImportForLayer,
  removePresentationEntry,
  createLidarLayer: vi.fn(),
  deleteLidarLayer: vi.fn(),
  fetchLidarLayerDeleteImpact: vi.fn(),
  presentEntity: vi.fn(),
  renameLidarLayer: vi.fn(),
  cancelOpenImport: vi.fn(),
}))

// Hoisted so the mock factory cannot close over a later-initialised binding.
const store = vi.hoisted(() => {
  const library = {
    layers: [] as unknown[],
    analyses: [] as unknown[],
    engine: { available: true, version: null, detail: null },
  }
  return { library }
})

vi.mock('../app/lidar/library-store', async () => {
  const signals = await import('@preact/signals')
  return {
    installLidarLibraryObserver: () => () => {},
    lidarLibrary: signals.signal(store.library),
    lidarStatusMessage: signals.signal<string | null>(null),
    openImportJob: signals.signal<unknown>(null),
    refreshLidarLibrary: vi.fn().mockResolvedValue(undefined),
    ensureLidarPolling: vi.fn(),
    trackImportJob: vi.fn(),
  }
})

const storeModule = await import('../app/lidar/library-store')
const statusMessage = storeModule.lidarStatusMessage as ReturnType<typeof signal<string | null>>
const openImportJob = storeModule.openImportJob as ReturnType<typeof signal<unknown>>
const library = store.library

import { AnalysisPanel } from '../components/panels/lidar/AnalysisPanel'
import { DataPanel } from '../components/panels/lidar/DataPanel'
import { locale } from '../app/settings/state'

function groundLayer() {
  return {
    id: 'lyr-1',
    name: 'IGN ground',
    measurement_kind: 'GroundElevation',
    units: 'm',
    state: 'Ready',
    coverage_cells: '10',
    resolution_m: 0.5,
    bounds: null,
    value_range: [0, 10],
    analysis_count: 0,
    tilesets: [],
  }
}

describe('Analysis panel corrections', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    statusMessage.value = null
    library.layers = [groundLayer()]
    library.analyses = []
    analyseLayerAsSlope.mockReset().mockResolvedValue(undefined)
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  /**
   * The Run button, whatever it currently says.
   *
   * Its label changes with its state — create, running, retry — so matching one
   * label would make a state change look like a missing control.
   */
  function runButton(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      /slope|running|retry/i.test(node.textContent ?? ''),
    )
    if (!button) throw new Error('the Run button is not rendered')
    return button as HTMLButtonElement
  }

  /**
   * A failed Run used to settle with no visible explanation anywhere: the
   * action swallowed the failure into a shared status the panel never rendered,
   * while the panel waited for a rejection that never came.
   */
  it('shows the failure the action published as well as one it threw', () => {
    statusMessage.value = 'the input changed since this run was prepared'
    act(() => {
      render(<AnalysisPanel />, container)
    })
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('the input changed since this run was prepared')
  })

  /**
   * Run used to stay enabled until a library refresh reported Preparing, so a
   * second click during the initial request started a duplicate definition.
   */
  it('refuses a second Run before the first request settles', async () => {
    let release: (() => void) | null = null
    analyseLayerAsSlope.mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve }),
    )
    act(() => {
      render(<AnalysisPanel />, container)
    })
    const input = container.querySelector<HTMLInputElement>('input[type="radio"][value="lyr-1"]')
    expect(input).not.toBeNull()
    act(() => {
      input!.click()
    })

    const first = runButton()
    act(() => {
      first.click()
    })
    expect(analyseLayerAsSlope).toHaveBeenCalledTimes(1)

    // The panel has not re-read the library yet, so nothing else would disable
    // the button; only the submit latch can refuse this click.
    act(() => {
      runButton().click()
    })
    expect(analyseLayerAsSlope).toHaveBeenCalledTimes(1)
    expect(runButton().disabled).toBe(true)

    await act(async () => {
      release?.()
    })
    await vi.waitFor(() => expect(runButton().disabled).toBe(false))
  })
})

describe('Data panel import job corrections', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    statusMessage.value = null
    openImportJob.value = null
    library.layers = [groundLayer()]
    library.analyses = []
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  /**
   * Data starts an import, so Data must show its progress: the review found the
   * progress and the Apply step living only in another panel, so the user had to
   * discover where their own import had gone.
   */
  it('renders the tracked job of its own layer with progress and Cancel', () => {
    openImportJob.value = {
      job_id: 'job-1',
      layer_id: 'lyr-1',
      state: 'Staging',
      review: null,
      message: null,
      progress: { phase: 'PreparingRaster', percent: 40 },
    }
    act(() => {
      render(<DataPanel />, container)
    })
    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Importing')
    const bar = container.querySelector('progress')
    expect(bar?.getAttribute('value')).toBe('40')
    const cancel = Array.from(container.querySelectorAll('button')).find((node) =>
      (node.textContent ?? '').toLowerCase().includes('cancel'),
    )
    expect(cancel).toBeDefined()
  })

  it('names the failure and offers Retry when the job failed', () => {
    openImportJob.value = {
      job_id: 'job-1',
      layer_id: 'lyr-1',
      state: 'Failed',
      review: null,
      message: 'the third file is not a supported single-band raster',
      progress: null,
    }
    act(() => {
      render(<DataPanel />, container)
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'the third file is not a supported single-band raster',
    )
    const retry = Array.from(container.querySelectorAll('button')).find((node) =>
      (node.textContent ?? '').toLowerCase().includes('retry'),
    )
    expect(retry).toBeDefined()
  })

  /**
   * A generation that was never counted reports "Not calculated".
   *
   * The distinction is the whole point of the nullable count: unknown coverage
   * is not zero hectares, and a panel that renders 0 ha states a measurement
   * nobody took.
   */
  it('reports unknown coverage as not calculated rather than zero area', () => {
    library.layers = [{ ...groundLayer(), coverage_cells: null }]
    act(() => {
      render(<DataPanel />, container)
    })
    const facts = container.querySelector('dl')
    const labels = Array.from(facts?.querySelectorAll('dt') ?? []).map((node) => node.textContent)
    const values = Array.from(facts?.querySelectorAll('dd') ?? []).map((node) => node.textContent)
    const index = labels.findIndex((label) => label?.toLowerCase() === 'coverage')
    expect(index, `coverage row among ${labels.join(', ')}`).toBeGreaterThanOrEqual(0)
    expect(values[index]).toBe('Not calculated')
  })

  it('still reports a measured zero as zero', () => {
    library.layers = [{ ...groundLayer(), coverage_cells: '0' }]
    act(() => {
      render(<DataPanel />, container)
    })
    const facts = container.querySelector('dl')
    const labels = Array.from(facts?.querySelectorAll('dt') ?? []).map((node) => node.textContent)
    const values = Array.from(facts?.querySelectorAll('dd') ?? []).map((node) => node.textContent)
    const index = labels.findIndex((label) => label?.toLowerCase() === 'coverage')
    expect(index, `coverage row among ${labels.join(', ')}`).toBeGreaterThanOrEqual(0)
    expect(values[index]).toContain('0 ha')
  })

  it('shows another layer its own import action rather than this job', () => {
    openImportJob.value = {
      job_id: 'job-2',
      layer_id: 'lyr-other',
      state: 'Staging',
      review: null,
      message: null,
      progress: { phase: 'PreparingRaster', percent: 10 },
    }
    act(() => {
      render(<DataPanel />, container)
    })
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
