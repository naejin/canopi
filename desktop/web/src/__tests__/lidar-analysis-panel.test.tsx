import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ensurePolling = vi.hoisted(() => vi.fn())

const retryAnalysisMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const analyseMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../app/lidar/actions', () => ({
  analyseLayerAsSlope: analyseMock,
  cancelAnalysisJob: vi.fn().mockResolvedValue(undefined),
  retryAnalysis: retryAnalysisMock,
  runningAnalysisJobId: () => null,
}))

vi.mock('../app/lidar/polling', () => ({
  ensureLidarPolling: ensurePolling,
}))

const library = vi.hoisted(() => {
  const state = {
    layers: [] as unknown[],
    analyses: [] as unknown[],
    engine: { available: true, version: null, detail: null },
  }
  return { state }
})

vi.mock('../app/lidar/library-store', async () => {
  const { signal } = await import('@preact/signals')
  return {
    installLidarLibraryObserver: () => () => {},
    lidarLibrary: signal(library.state),
    lidarStatusMessage: signal<string | null>(null),
    refreshLidarLibrary: vi.fn().mockResolvedValue(undefined),
  }
})

import { AnalysisPanel } from '../components/panels/lidar/AnalysisPanel'
import { locale } from '../app/settings/state'

function eligibleLayer() {
  // A ground-elevation layer with a head is what makes the Run button enabled.
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
    tilesets: [],
  }
}


describe('Analysis panel result name', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    library.state.layers = [eligibleLayer()]
    library.state.analyses = []
    container = document.createElement('div')
    document.body.append(container)
    act(() => {
      render(<AnalysisPanel />, container)
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('offers a result-name field beside the units choice', () => {
    // The field is optional, so it must be present without being required.
    const label = Array.from(container.querySelectorAll('label')).find((node) =>
      (node.textContent ?? '').includes('Result name'),
    )
    expect(label).toBeDefined()
    expect(label?.querySelector('input[type="text"]')).not.toBeNull()
  })
})

describe('Analysis panel per-definition Retry', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    retryAnalysisMock.mockClear()
    analyseMock.mockClear()
    library.state.layers = [{
      ...eligibleLayer(),
      tilesets: [{ style: 'elevation', source: { kind: 'native-generation', generation_id: 'gen-1' }, min_zoom: 0, max_zoom: 1, tile_size: 256, bounds: null }],
    }]
    library.state.analyses = [
      {
        id: 'adef-a', source_layer_id: 'lyr-1', kind: 'Slope', name: 'First', state: 'Failed',
        detail: 'a', bounds: null, value_range: null, slope_unit: 'Degrees', tilesets: [],
      },
      {
        id: 'adef-b', source_layer_id: 'lyr-1', kind: 'Slope', name: 'Second', state: 'Failed',
        detail: 'b', bounds: null, value_range: null, slope_unit: 'Percent', tilesets: [],
      },
    ]
    container = document.createElement('div')
    document.body.append(container)
    act(() => {
      render(<AnalysisPanel />, container)
    })
    // Select the ground layer so its failed results are listed.
    const input = container.querySelector<HTMLInputElement>('input[name="analysis-input"]')
    expect(input).not.toBeNull()
    act(() => {
      input?.click()
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('R50: retries the chosen failed definition and keeps Create on the form', async () => {
    const retryButtons = Array.from(container.querySelectorAll('button')).filter((button) =>
      (button.textContent ?? '').includes('Retry analysis'),
    )
    expect(retryButtons).toHaveLength(2)
    // The primary button remains Create, not a guessed Retry.
    const primary = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('Create slope'),
    )
    expect(primary).toBeDefined()

    act(() => {
      retryButtons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(retryAnalysisMock).toHaveBeenCalledWith('adef-b', 'gen-1')
    expect(retryAnalysisMock).toHaveBeenCalledTimes(1)
    expect(analyseMock).not.toHaveBeenCalled()
  })
})
