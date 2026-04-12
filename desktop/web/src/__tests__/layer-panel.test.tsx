import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LayerPanel } from '../components/canvas/LayerPanel'
import { currentDesign } from '../state/document'
import { locale } from '../state/app'
import {
  activeLayerName,
  gridVisible,
  layerLockState,
  layerOpacity,
  layerPanelOpen,
  layerVisibility,
} from '../state/canvas'

describe('LayerPanel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 0,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    layerPanelOpen.value = true
    activeLayerName.value = 'base'
    gridVisible.value = true
    layerVisibility.value = { base: true, plants: true, zones: true, annotations: true }
    layerLockState.value = {}
    layerOpacity.value = { base: 1, plants: 1, zones: 1, annotations: 1 }
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('treats the base row as basemap visibility and keeps grid independent', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    const rows = Array.from(container.querySelectorAll('[role="listitem"]'))
    const basemapRow = rows.find((row) => row.textContent?.includes('Basemap'))
    expect(basemapRow).toBeTruthy()

    const basemapToggle = basemapRow?.querySelector('button')
    expect(basemapToggle).toBeTruthy()

    await act(async () => {
      basemapToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(layerVisibility.value.base).toBe(false)
    expect(gridVisible.value).toBe(true)
    expect(container.textContent).toContain('Grid')
  })
})
