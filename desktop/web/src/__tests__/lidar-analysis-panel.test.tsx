import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ensurePolling = vi.hoisted(() => vi.fn())

vi.mock('../app/lidar/actions', () => ({
  analyseLayerAsSlope: vi.fn().mockResolvedValue(undefined),
  cancelAnalysisJob: vi.fn().mockResolvedValue(undefined),
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
