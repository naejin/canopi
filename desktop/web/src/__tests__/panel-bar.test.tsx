import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PanelBar } from '../components/panels/PanelBar'
import { activePanel, locale, sidePanel } from '../app/shell/state'
import { currentDesign } from '../state/document'

describe('PanelBar', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    activePanel.value = 'canvas'
    sidePanel.value = null
    currentDesign.value = {
      version: 1,
      name: 'test',
      description: null,
      location: null,
      north_bearing_deg: null,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '',
      updated_at: '',
      extra: {},
    }
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders the location entry point and routes to the location shell', async () => {
    await act(async () => {
      render(<PanelBar />, container)
    })

    const locationButton = container.querySelector('button[aria-label="Design Location"]') as HTMLButtonElement | null
    expect(locationButton).toBeTruthy()
    expect(locationButton?.disabled).toBe(false)

    await act(async () => {
      locationButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activePanel.value).toBe('location')
    expect(sidePanel.value).toBe(null)
  })
})
