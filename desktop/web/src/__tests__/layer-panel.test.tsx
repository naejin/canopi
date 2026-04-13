import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LayerPanel } from '../components/canvas/LayerPanel'
import { currentDesign } from '../state/document'
import { locale } from '../state/app'
import {
  activeLayerName,
  contourIntervalMeters,
  gridVisible,
  hillshadeOpacity,
  hillshadeVisible,
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
    contourIntervalMeters.value = 0
    hillshadeVisible.value = false
    hillshadeOpacity.value = 0.55
    layerVisibility.value = { base: true, contours: false, plants: true, zones: true, annotations: true }
    layerLockState.value = {}
    layerOpacity.value = { base: 1, contours: 1, plants: 1, zones: 1, annotations: 1 }
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
    expect(container.textContent).toContain('Current')
    expect(container.textContent).toContain('48.8566, 2.3522')

    const basemapToggle = basemapRow?.querySelector('button')
    expect(basemapToggle).toBeTruthy()

    await act(async () => {
      basemapToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(layerVisibility.value.base).toBe(false)
    expect(gridVisible.value).toBe(true)
    expect(container.textContent).toContain('Grid')
  })

  it('exposes terrain controls without coupling them to the basemap toggle', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    const contourToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Toggle visibility: Contour lines')
    expect(contourToggle).toBeTruthy()

    await act(async () => {
      contourToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(layerVisibility.value.contours).toBe(true)
    expect(layerVisibility.value.base).toBe(true)

    const contourSlider = container.querySelector<HTMLInputElement>('input[aria-label="Opacity: Contour lines"]')
    expect(contourSlider).toBeTruthy()
    await act(async () => {
      if (!contourSlider) return
      contourSlider.value = '45'
      contourSlider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(layerOpacity.value.contours).toBe(0.45)

    const intervalInput = container.querySelector<HTMLInputElement>('input[aria-label="Contour interval"]')
    expect(intervalInput).toBeTruthy()
    await act(async () => {
      if (!intervalInput) return
      intervalInput.value = '25'
      intervalInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(contourIntervalMeters.value).toBe(25)

    const hillshadeToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Toggle visibility: Hillshading')
    expect(hillshadeToggle).toBeTruthy()
    await act(async () => {
      hillshadeToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(hillshadeVisible.value).toBe(true)

    const hillshadeSlider = container.querySelector<HTMLInputElement>('input[aria-label="Hillshade opacity"]')
    expect(hillshadeSlider).toBeTruthy()
    await act(async () => {
      if (!hillshadeSlider) return
      hillshadeSlider.value = '30'
      hillshadeSlider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(hillshadeOpacity.value).toBe(0.3)
  })
})
