import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locale } from '../app/settings/state'
import { openImportJob } from '../app/lidar/library-store'
import { LidarLayersSection } from '../components/panels/lidar/LidarLayersSection'

/**
 * Import progress is reported where the import was started.
 *
 * The retired review screen mounted a second surface the user had to navigate
 * back to; the one-step route never waits for a decision, so the Layers
 * presentation reports the phase in place and Data reports the same job beside
 * its own layer.
 */
describe('LiDAR import progress', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    openImportJob.value = null
    container.remove()
  })

  it('reports the backend phase and percentage in the presentation list', async () => {
    openImportJob.value = {
      job_id: 'job-1',
      layer_id: 'layer-1',
      state: 'Applying',
      review: null,
      message: null,
      progress: { phase: 'RenderingMap', percent: 68 },
    }

    await act(() => render(<LidarLayersSection />, container))

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Rendering map')
    expect(status?.textContent).toContain('68%')
  })

  it('reports a settled job by its state instead of a stale phase', async () => {
    openImportJob.value = {
      job_id: 'job-1',
      layer_id: 'layer-1',
      state: 'Failed',
      review: null,
      message: 'broken.tif: not recognized as a supported file format',
      progress: null,
    }

    await act(() => render(<LidarLayersSection />, container))

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toBe('Import failed')
  })

  it('reports nothing when no import is tracked', async () => {
    await act(() => render(<LidarLayersSection />, container))
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
