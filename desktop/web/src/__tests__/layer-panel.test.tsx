import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))

import { LayerPanel } from '../components/canvas/LayerPanel'
import { setSettings } from '../ipc/settings'
import { currentDesign } from '../state/design'
import { locale } from '../app/shell/state'
import { flushQueuedSettingsPersist, setBootstrappedSettings } from '../app/settings/persistence'
import {
  activeLayerName,
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerPanelOpen,
  layerVisibility,
} from '../state/canvas'

describe('LayerPanel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    vi.mocked(setSettings).mockClear()
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
    layerVisibility.value = { base: true, contours: false, plants: true, zones: true, annotations: true }
    layerOpacity.value = { base: 1, contours: 1, plants: 1, zones: 1, annotations: 1 }
    contourIntervalMeters.value = 0
    hillshadeVisible.value = false
    hillshadeOpacity.value = 0.55
    setBootstrappedSettings({
      locale: 'en',
      theme: 'light',
      snap_to_grid: true,
      snap_to_guides: true,
      show_smart_guides: true,
      auto_save_interval_s: 60,
      confirm_destructive: true,
      default_currency: 'EUR',
      measurement_units: 'metric',
      show_botanical_names: true,
      debug_logging: false,
      check_updates: true,
      default_design_dir: '',
      recent_files_max: 20,
      last_active_panel: 'canvas',
      bottom_panel_open: false,
      bottom_panel_height: 200,
      bottom_panel_tab: 'budget',
      map_layer_visible: true,
      map_style: 'street',
      map_opacity: 1,
      contour_visible: false,
      contour_opacity: 1,
      contour_interval: 0,
      hillshade_visible: false,
      hillshade_opacity: 0.55,
    })
  })

  afterEach(() => {
    flushQueuedSettingsPersist()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    render(null, container)
    container.remove()
  })

  it('treats the base row as basemap visibility', async () => {
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
  })

  it('exposes terrain controls without coupling them to the basemap toggle', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    // Toggle contours visibility via eye button
    const contourToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Toggle visibility: Contour lines')
    expect(contourToggle).toBeTruthy()

    await act(async () => {
      contourToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(layerVisibility.value.contours).toBe(true)
    expect(layerVisibility.value.base).toBe(true)

    // Click the contours name to make it active and reveal controls
    const contourName = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Contour lines')
    expect(contourName).toBeTruthy()
    await act(async () => {
      contourName?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const contourSlider = container.querySelector<HTMLInputElement>('input[aria-label="Contour interval"]')
    expect(contourSlider).toBeTruthy()
    await act(async () => {
      if (!contourSlider) return
      contourSlider.value = '25'
      contourSlider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(contourIntervalMeters.value).toBe(25)
    vi.runAllTimers()
    await Promise.resolve()
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      contour_visible: true,
      contour_interval: 25,
    }))

    // Toggle hillshade visibility
    const hillshadeToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Toggle visibility: Hillshading')
    expect(hillshadeToggle).toBeTruthy()
    await act(async () => {
      hillshadeToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(hillshadeVisible.value).toBe(true)

    // Click hillshading name to make it active and reveal controls
    const hillshadeName = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Hillshading')
    expect(hillshadeName).toBeTruthy()
    await act(async () => {
      hillshadeName?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const hillshadeSlider = container.querySelector<HTMLInputElement>('input[aria-label="Hillshade opacity"]')
    expect(hillshadeSlider).toBeTruthy()
    await act(async () => {
      if (!hillshadeSlider) return
      hillshadeSlider.value = '30'
      hillshadeSlider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(hillshadeOpacity.value).toBe(0.3)
    vi.runAllTimers()
    await Promise.resolve()
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      hillshade_visible: true,
      hillshade_opacity: 0.3,
    }))
  })
})
