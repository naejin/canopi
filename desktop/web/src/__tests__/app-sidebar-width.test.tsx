import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/shared/TitleBar', () => ({ TitleBar: () => <div data-testid="title-bar" /> }))
vi.mock('../components/shared/DegradedBanner', () => ({ DegradedBanner: () => null }))
vi.mock('../components/shared/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('../components/shared/ProblemReportDialog', () => ({ ProblemReportDialog: () => null }))
vi.mock('../components/panels/CanvasPanel', () => ({ CanvasPanel: () => <div data-testid="canvas-panel" /> }))
vi.mock('../components/panels/PanelBar', () => ({ PanelBar: () => <div data-testid="panel-bar" /> }))
vi.mock('../components/panels/PlantDbPanel', () => ({ PlantDbPanel: () => <div data-testid="plant-db-panel" /> }))
vi.mock('../app/shell/controller', () => ({ commitSidePanelWidth: vi.fn() }))

import { App } from '../app'
import { commitSidePanelWidth } from '../app/shell/controller'
import { activePanel, sidePanel, sidePanelWidth } from '../app/shell/state'
import { locale } from '../app/settings/state'

function resizeHandle(container: HTMLDivElement): HTMLDivElement {
  const handle = container.querySelector('[role="separator"][aria-orientation="vertical"]')
  expect(handle).toBeInstanceOf(HTMLDivElement)
  return handle as HTMLDivElement
}

function sidePanelElement(container: HTMLDivElement): HTMLDivElement {
  const panel = container.querySelector('[style*="--side-panel-width"]')
  expect(panel).toBeInstanceOf(HTMLDivElement)
  return panel as HTMLDivElement
}

describe('App sidebar width', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    activePanel.value = 'canvas'
    sidePanel.value = 'plant-db'
    sidePanelWidth.value = null
    vi.mocked(commitSidePanelWidth).mockClear()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('uses a responsive first-use width when no explicit width is saved', async () => {
    await act(async () => {
      render(<App />, container)
    })

    expect(sidePanelElement(container).getAttribute('style')).toContain('--side-panel-width: clamp(320px, 35vw, 520px)')
  })

  it('renders a saved width and commits resize drags through the settings controller', async () => {
    sidePanelWidth.value = 480

    await act(async () => {
      render(<App />, container)
    })

    const panel = sidePanelElement(container)
    panel.getBoundingClientRect = () => ({
      width: 480,
      height: 800,
      top: 0,
      right: 480,
      bottom: 800,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    await act(async () => {
      resizeHandle(container).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 700 }))
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 640 }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 640 }))
    })

    expect(panel.style.width).toBe('540px')
    expect(commitSidePanelWidth).toHaveBeenCalledWith(540)
  })

  it('does not persist the responsive default from a resize-handle click without movement', async () => {
    await act(async () => {
      render(<App />, container)
    })

    await act(async () => {
      resizeHandle(container).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 700 }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 700 }))
    })

    expect(commitSidePanelWidth).not.toHaveBeenCalled()
  })
})
