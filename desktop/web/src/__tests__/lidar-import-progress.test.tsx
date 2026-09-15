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
})
