import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PanelBar } from '../components/panels/PanelBar'
import { activePanel, sidePanel } from '../app/shell/state'
import { locale } from '../app/settings/state'
import { appCommandGraphPanelProjection } from '../commands/registry'
import { designSessionFixture } from './support/design-session-state'

describe('PanelBar', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    activePanel.value = 'canvas'
    sidePanel.value = null
    designSessionFixture.file = {
      version: 7,
      name: 'test',
      description: null,
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

  function panelButtonLabels(): string[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Panels"] button'))
      .map((button) => button.getAttribute('aria-label') ?? '')
  }

  it('renders panel icons with normal toolbar stroke weight', async () => {
    await act(async () => {
      render(<PanelBar />, container)
    })

    const strokes = Array.from(container.querySelectorAll<SVGElement>('nav[aria-label="Panels"] svg'))
      .map((icon) => icon.getAttribute('stroke-width') ?? icon.getAttribute('strokeWidth'))
    expect(strokes).toEqual(Array(10).fill('1.5'))
  })

  it('orders the Design Notebook before plant-library panels', async () => {
    await act(async () => {
      render(<PanelBar />, container)
    })

    expect(panelButtonLabels()).toEqual([
      'Design Canvas',
      'Species key',
      'Data Library',
      'Layers',
      'Calendar',
      'Budget',
      'Consortium',
      'Design notebook',
      'Plant Database',
      'Favorites',
    ])
  })

  it('does not render a Design Location entry point', async () => {
    await act(async () => {
      render(<PanelBar />, container)
    })

    expect(container.querySelector('button[aria-label="Design Location"]')).toBeNull()
  })

  it('disables design-dependent panel entry points when no design is open', async () => {
    designSessionFixture.file = null

    await act(async () => {
      render(<PanelBar />, container)
    })

    expect(panelButton('Design Canvas').disabled).toBe(false)
    expect(panelButton('Design Canvas').getAttribute('aria-pressed')).toBe('true')
    expect(panelButton('Species key').disabled).toBe(true)
    expect(panelButton('Layers').disabled).toBe(true)
    expect(panelButton('Plant Database').disabled).toBe(true)
    expect(panelButton('Design notebook').disabled).toBe(false)
    expect(panelButton('Favorites').disabled).toBe(true)
  })

  it('keeps an active no-design Plant Database panel button enabled so it can close the panel', async () => {
    designSessionFixture.file = null
    const panels = appCommandGraphPanelProjection.value
    const plantDb = [...panels.primary, ...panels.design, ...panels.side]
      .find((command) => command.commandId === 'nav.plantDb')!
    plantDb.action()

    await act(async () => {
      render(<PanelBar />, container)
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(panelButton('Plant Database').disabled).toBe(false)
    expect(panelButton('Plant Database').getAttribute('aria-pressed')).toBe('true')
    expect(panelButton('Design notebook').disabled).toBe(false)
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

    expect(container.querySelector('button[aria-label="Layers"] [role="tooltip"]')?.textContent)
      .toContain('Layers')

    await act(async () => {
      locale.value = 'fr'
      await Promise.resolve()
    })

    const layersButton = container.querySelector('button[aria-label="Calques"]')
    expect(layersButton).not.toBeNull()
    expect(layersButton?.querySelector('[role="tooltip"]')?.textContent)
      .toContain('Calques')
  })
})
