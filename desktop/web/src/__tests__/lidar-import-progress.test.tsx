import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locale } from '../app/settings/state'
import { importPanelOpen, openImportJob } from '../app/lidar/library-store'
import { LidarImportPanel } from '../components/panels/lidar/LidarLayersSection'

describe('LiDAR import progress', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.append(container)
    importPanelOpen.value = true
  })

  afterEach(() => {
    render(null, container)
    openImportJob.value = null
    importPanelOpen.value = false
    container.remove()
  })

  it('shows the backend phase and percentage with determinate progress semantics', async () => {
    openImportJob.value = {
      job_id: 'job-1',
      layer_id: 'layer-1',
      state: 'Applying',
      review: null,
      message: null,
      progress: { phase: 'RenderingMap', percent: 68 },
    }

    await act(() => render(<LidarImportPanel />, container))

    const progressbar = container.querySelector<HTMLElement>('[role="progressbar"]')
    expect(progressbar?.getAttribute('aria-label')).toBe('Rendering map')
    expect(progressbar?.getAttribute('aria-valuemin')).toBe('0')
    expect(progressbar?.getAttribute('aria-valuemax')).toBe('100')
    expect(progressbar?.getAttribute('aria-valuenow')).toBe('68')
    expect(container.textContent).toContain('Rendering map')
    expect(container.textContent).toContain('68%')
  })

  it('confirms an addition above the existing sources instead of a merge decision', async () => {
    openImportJob.value = {
      job_id: 'job-2',
      layer_id: 'layer-1',
      state: 'AwaitingReview',
      review: {
        job_id: 'job-2',
        layer_id: 'layer-1',
        compatible: true,
        issues: [],
        sources: [{
          filename: 'mnt.tif',
          sha256: 'a'.repeat(64),
          size_bytes: '1024',
          width: 4,
          height: 4,
          pixel_size_m: 1,
          nodata: null,
          value_range: [0, 9],
          compatible: true,
          issues: [],
        }],
        uncovered_cells: '16',
        overlap_cells: '0',
        invalid_cells: '0',
        before_preview_path: null,
        after_preview_path: null,
      },
      message: null,
      progress: null,
    }

    await act(() => render(<LidarImportPanel />, container))

    // The retired merge route offered "Add uncovered" / "Replace overlap" and
    // a Before/After tab pair; the ordered route adds the selection as one
    // group above the accepted sources and says so.
    expect(container.textContent).not.toContain('Replace overlap')
    expect(container.textContent).not.toContain('Before')
    expect(container.textContent).toContain('The selected sources are added above')
    const confirm = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Add sources')
    expect(confirm).toBeDefined()
    expect(confirm?.disabled).toBe(false)
  })

  it('refuses the confirmation while any selected source is incompatible', async () => {
    openImportJob.value = {
      job_id: 'job-3',
      layer_id: 'layer-1',
      state: 'AwaitingReview',
      review: {
        job_id: 'job-3',
        layer_id: 'layer-1',
        compatible: false,
        issues: [],
        sources: [{
          filename: 'foreign.tif',
          sha256: 'b'.repeat(64),
          size_bytes: '1024',
          width: 4,
          height: 4,
          pixel_size_m: 1,
          nodata: null,
          value_range: [0, 9],
          compatible: false,
          issues: ['horizontal CRS differs from the layer'],
        }],
        uncovered_cells: '0',
        overlap_cells: '0',
        invalid_cells: '0',
        before_preview_path: null,
        after_preview_path: null,
      },
      message: null,
      progress: null,
    }

    await act(() => render(<LidarImportPanel />, container))

    expect(container.textContent).toContain('horizontal CRS differs from the layer')
    const confirm = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Add sources')
    expect(confirm?.disabled).toBe(true)
  })
})
