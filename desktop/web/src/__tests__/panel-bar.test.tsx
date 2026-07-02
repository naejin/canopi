import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PanelBar } from '../components/panels/PanelBar'
import { activePanel, sidePanel } from '../app/shell/state'
import { locale } from '../app/settings/state'
import { runAppCommand } from '../commands/registry'
import { currentDesign } from './support/design-session-state'

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
      budget_currency: 'EUR',
      created_at: '',
      updated_at: '',
      extra: {},
    }
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  function panelButton(label: string): HTMLButtonElement {
    const button = container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
    if (!button) throw new Error(`Missing panel button ${label}`)
    return button
  }

  it('renders panel icons with normal toolbar stroke weight', async () => {
    await act(async () => {
      render(<PanelBar />, container)
    })

    const strokes = Array.from(container.querySelectorAll<SVGElement>('nav[aria-label="Panels"] svg'))
      .map((icon) => icon.getAttribute('stroke-width') ?? icon.getAttribute('strokeWidth'))
    expect(strokes).toEqual(['1.5', '1.5', '1.5', '1.5', '1.5'])
  })

  it('renders the location entry point and routes to the location shell', async () => {
    await act(async () => {
      render(<PanelBar />, container)
    })

    const locationButton = panelButton('Design Location')
    expect(locationButton.disabled).toBe(false)

    await act(async () => {
      locationButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activePanel.value).toBe('location')
    expect(sidePanel.value).toBe(null)
  })

  it('disables design-dependent panel entry points when no design is open', async () => {
    currentDesign.value = null

    await act(async () => {
      render(<PanelBar />, container)
    })

    expect(panelButton('Design Canvas').disabled).toBe(false)
    expect(panelButton('Design Canvas').getAttribute('aria-pressed')).toBe('true')
    expect(panelButton('Design Location').disabled).toBe(true)
    expect(panelButton('Plant Database').disabled).toBe(true)
    expect(panelButton('Design Notebook').disabled).toBe(false)
    expect(panelButton('Favorites').disabled).toBe(true)
  })

  it('keeps an active no-design Plant Database panel button enabled so it can close the panel', async () => {
    currentDesign.value = null
    runAppCommand('nav.plantDb')

    await act(async () => {
      render(<PanelBar />, container)
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(panelButton('Plant Database').disabled).toBe(false)
    expect(panelButton('Plant Database').getAttribute('aria-pressed')).toBe('true')
    expect(panelButton('Design Notebook').disabled).toBe(false)
    expect(panelButton('Favorites').disabled).toBe(true)

    await act(async () => {
      panelButton('Plant Database').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
    expect(panelButton('Plant Database').disabled).toBe(true)
    expect(panelButton('Plant Database').getAttribute('aria-pressed')).toBe('false')
  })

  it('toggles side panels through the command graph projection click path', async () => {
    await act(async () => {
      render(<PanelBar />, container)
    })

    expect(panelButton('Plant Database').disabled).toBe(false)
    expect(panelButton('Plant Database').getAttribute('aria-pressed')).toBe('false')

    await act(async () => {
      panelButton('Plant Database').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(panelButton('Plant Database').getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      panelButton('Plant Database').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
    expect(panelButton('Plant Database').getAttribute('aria-pressed')).toBe('false')
  })

  it('updates panel button tooltips immediately when the locale changes', async () => {
    await act(async () => {
      render(<PanelBar />, container)
    })

    expect(container.querySelector('button[aria-label="Design Location"] [role="tooltip"]')?.textContent)
      .toContain('Design Location')

    await act(async () => {
      locale.value = 'fr'
      await Promise.resolve()
    })

    const locationButton = container.querySelector('button[aria-label="Emplacement du design"]')
    expect(locationButton).not.toBeNull()
    expect(locationButton?.querySelector('[role="tooltip"]')?.textContent)
      .toContain('Emplacement du design')
  })
})
