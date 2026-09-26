import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PanelRail } from '../components/shared/PanelRail'
import { DesktopPanelRail } from '../components/panels/DesktopPanelRail'
import { activePanel, sidePanel } from '../app/shell/state'
import { locale } from '../app/settings/state'
import { appCommandGraphPanelProjection } from '../commands/registry'
import { designSessionFixture } from './support/design-session-state'

/** The rail over the live projection, rendered even without a Design (DesktopPanelRail hides then). */
function ProjectedRail() {
  const projection = appCommandGraphPanelProjection.value
  return <PanelRail label="Panels" groups={[projection.design, projection.planning]} />
}

describe('Panel rail', () => {
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

  it('draws panel icons on the shared 1.6 stroke grid', async () => {
    await act(async () => {
      render(<ProjectedRail />, container)
    })

    const strokes = Array.from(container.querySelectorAll<SVGElement>('nav[aria-label="Panels"] svg'))
      .map((icon) => icon.getAttribute('stroke-width'))
    expect(strokes).toEqual(Array(9).fill('1.6'))
  })

  it('orders panels as the rail groups them, with Ctrl 1–8', async () => {
    await act(async () => {
      render(<ProjectedRail />, container)
    })

    expect(panelButtonLabels()).toEqual([
      'Layers',
      'Data library',
      'Plants in this Design',
      'Plant catalog',
      'Favorites and stamps',
      'Calendar',
      'Budget',
      'Consortium',
      'Design notebook',
    ])
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1)
    expect(panelButton('Layers').getAttribute('aria-keyshortcuts')).toBe('Control+1 Meta+1')
    expect(panelButton('Design notebook').querySelector('[role="tooltip"]')?.textContent).toContain('Ctrl 8')
    expect(panelButton('Data library').hasAttribute('aria-keyshortcuts')).toBe(false)
  })

  it('does not render a Design Location or canvas entry point', async () => {
    await act(async () => {
      render(<ProjectedRail />, container)
    })

    expect(container.querySelector('button[aria-label="Design Location"]')).toBeNull()
    expect(container.querySelector('button[data-panel="canvas"]')).toBeNull()
  })

  it('hides the Desktop rail on the start screen', async () => {
    designSessionFixture.file = null
    await act(async () => {
      render(<DesktopPanelRail />, container)
    })
    expect(container.querySelector('nav')).toBeNull()
  })

  it('disables design-dependent panel entry points when no design is open', async () => {
    designSessionFixture.file = null

    await act(async () => {
      render(<ProjectedRail />, container)
    })

    expect(panelButton('Plants in this Design').disabled).toBe(true)
    expect(panelButton('Layers').disabled).toBe(true)
    expect(panelButton('Plant catalog').disabled).toBe(true)
    expect(panelButton('Design notebook').disabled).toBe(false)
    expect(panelButton('Favorites and stamps').disabled).toBe(true)
  })

  it('keeps an active no-design Plant Database panel button enabled so it can close the panel', async () => {
    designSessionFixture.file = null
    const panels = appCommandGraphPanelProjection.value
    const plantDb = [...panels.primary, ...panels.design, ...panels.planning]
      .find((command) => command.commandId === 'nav.plantDb')!
    plantDb.action()

    await act(async () => {
      render(<ProjectedRail />, container)
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(panelButton('Plant catalog').disabled).toBe(false)
    expect(panelButton('Plant catalog').getAttribute('aria-expanded')).toBe('true')
    expect(panelButton('Design notebook').disabled).toBe(false)
    expect(panelButton('Favorites and stamps').disabled).toBe(true)

    await act(async () => {
      panelButton('Plant catalog').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
    expect(panelButton('Plant catalog').disabled).toBe(true)
    expect(panelButton('Plant catalog').getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles side panels through the command graph projection click path', async () => {
    await act(async () => {
      render(<ProjectedRail />, container)
    })

    expect(panelButton('Plant catalog').disabled).toBe(false)
    expect(panelButton('Plant catalog').getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      panelButton('Plant catalog').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(panelButton('Plant catalog').getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      panelButton('Plant catalog').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
    expect(panelButton('Plant catalog').getAttribute('aria-expanded')).toBe('false')
  })

  it('updates panel button tooltips immediately when the locale changes', async () => {
    await act(async () => {
      render(<ProjectedRail />, container)
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
