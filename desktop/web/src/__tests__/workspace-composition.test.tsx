import { render } from 'preact'
import { act } from 'preact/test-utils'
import { useEffect, useState } from 'preact/hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceComposition,
  validateWorkspaceSurfaces,
  type WorkspacePanelProjection,
  type WorkspaceSurfaces,
} from '../components/workspace/WorkspaceComposition'
import { activePanel, navigateTo, sidePanel, type Panel } from '../app/shell/state'
import { designSessionFixture } from './support/design-session-state'
import { appCommandGraphPanelProjection } from '../commands/graph/projections'
import type { CanopiFile } from '../types/design'

const locating = vi.hoisted(() => ({ open: null as null | { value: boolean } }))
vi.mock('../app/site-onboarding/state', async (importOriginal) => {
  const original = await importOriginal<typeof import('../app/site-onboarding/state')>()
  const { signal } = await import('@preact/signals')
  const open = signal(false)
  locating.open = open
  return { ...original, siteLocateOpen: open }
})

function projection({
  primary = ['canvas'],
  design = [],
  planning = [],
}: {
  readonly primary?: readonly Panel[]
  readonly design?: readonly Panel[]
  readonly planning?: readonly Panel[]
} = {}): WorkspacePanelProjection {
  return {
    primary: primary.map(projectedCommand),
    design: design.map(projectedCommand),
    planning: planning.map(projectedCommand),
  }
}

function projectedCommand(panel: Panel): WorkspacePanelProjection['primary'][number] {
  return { panel, disabled: false }
}

describe('shared edition workspace composition', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    activePanel.value = 'canvas'
    sidePanel.value = null
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    designSessionFixture.file = null
  })

  it('closes every design side panel with its Design, in the same flush, and keeps the Catalog (canopi-f47t.41)', async () => {
    // The Desktop catalog's real panel projection: a design panel's command is unavailable without a Design.
    const Surface = () => <p data-testid="panel" />
    function Workspace() {
      const projection = appCommandGraphPanelProjection.value
      const surface = (commands: readonly { readonly panel: Panel }[]) => Object.fromEntries(commands.map(({ panel }) => [panel, Surface]))
      return (
        <WorkspaceComposition
          panelProjection={projection}
          surfaces={{ primary: { ...surface(projection.primary), canvas: Canvas }, side: { ...surface(projection.design), ...surface(projection.planning) } }}
        />
      )
    }
    await act(async () => { render(<Workspace />, container) })
    for (const panel of ['favorites', 'layers', 'budget'] as const) {
      await act(async () => { designSessionFixture.file = {} as CanopiFile; navigateTo(panel) })
      expect(container.querySelector(`[data-workspace-side-panel="${panel}"]`)).not.toBeNull()
      await act(() => { designSessionFixture.file = null })
      expect(container.querySelector('[data-workspace-side-panel]')).toBeNull()
      expect(sidePanel.value).toBeNull()
    }
    // The next Design opens with no panel.
    await act(async () => { designSessionFixture.file = {} as CanopiFile })
    expect(container.querySelector('[data-workspace-side-panel]')).toBeNull()

    await act(async () => { navigateTo('plant-db') })
    await act(() => { designSessionFixture.file = null })
    expect(container.querySelector('[data-workspace-side-panel="plant-db"]')).not.toBeNull()
    expect(sidePanel.value).toBe('plant-db')
  })

  it('keeps the same canvas and its interaction state while real clicks switch dock panels', async () => {
    let canvasMounts = 0
    function Canvas() {
      const [history, setHistory] = useState(0)
      const [selection, setSelection] = useState('none')
      const [view, setView] = useState(100)
      useEffect(() => {
        canvasMounts += 1
      }, [])
      return (
        <button
          type="button"
          data-testid="stateful-canvas"
          onClick={() => {
            setHistory((value) => value + 1)
            setSelection('plant-1')
            setView(125)
          }}
        >
          {history}:{selection}:{view}
        </button>
      )
    }
    const surfaces: WorkspaceSurfaces = {
      primary: { canvas: Canvas },
      side: { calendar: Calendar, budget: Budget },
    }

    await act(async () => {
      render(
        <>
          <button type="button" data-testid="open-calendar" onClick={() => navigateTo('calendar')}>Calendar</button>
          <button type="button" data-testid="open-budget" onClick={() => navigateTo('budget')}>Budget</button>
          <WorkspaceComposition
            panelProjection={projection({ design: ['calendar', 'budget'] })}
            surfaces={surfaces}
          />
        </>,
        container,
      )
    })
    const canvas = button(container, 'stateful-canvas')

    await act(async () => {
      canvas.focus()
      canvas.click()
      button(container, 'open-calendar').click()
    })
    expect(container.querySelector('[data-workspace-side-panel="calendar"]')).not.toBeNull()
    expect(button(container, 'stateful-canvas')).toBe(canvas)
    expect(canvas.textContent).toBe('1:plant-1:125')
    expect(canvasMounts).toBe(1)

    await act(async () => {
      button(container, 'open-budget').click()
    })
    expect(container.querySelector('[data-workspace-side-panel="budget"]')).not.toBeNull()
    expect(button(container, 'stateful-canvas')).toBe(canvas)
    expect(canvas.textContent).toBe('1:plant-1:125')
    expect(canvasMounts).toBe(1)
  })

  it('unmounts the canvas for a supported replacing primary route and remounts it on return', async () => {
    const unmounted = vi.fn()
    function Canvas() {
      useEffect(() => unmounted, [])
      return <div data-testid="canvas" />
    }
    const surfaces: WorkspaceSurfaces = {
      primary: { canvas: Canvas, templates: Templates },
      side: { calendar: Calendar },
    }

    await act(async () => {
      render(
        <WorkspaceComposition
          panelProjection={projection({ primary: ['canvas', 'templates'], design: ['calendar'] })}
          surfaces={surfaces}
        />,
        container,
      )
    })
    await act(async () => { navigateTo('calendar') })
    expect(container.querySelector('[data-workspace-side-panel="calendar"]')).not.toBeNull()
    expect(unmounted).not.toHaveBeenCalled()

    await act(async () => { navigateTo('templates') })
    expect(container.querySelector('[data-testid="templates"]')).not.toBeNull()
    expect(container.querySelector('[data-workspace-side-panel]')).toBeNull()
    expect(unmounted).toHaveBeenCalledOnce()

    await act(async () => { navigateTo('canvas') })
    expect(container.querySelector('[data-testid="canvas"]')).not.toBeNull()
  })

  it('hides the open dock panel while "Where is your site?" is showing, and keeps it for afterwards', async () => {
    sidePanel.value = 'layers'
    const Layers = () => <p data-testid="layers">Layers</p>
    await act(async () => {
      render(
        <WorkspaceComposition
          panelProjection={projection({ design: ['layers'] })}
          surfaces={{ primary: { canvas: Canvas }, side: { layers: Layers } }}
        />,
        container,
      )
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="layers"]')).not.toBeNull()

    await act(async () => { locating.open!.value = true })
    expect(container.querySelector('[data-workspace-side-panel]')).toBeNull()
    expect(sidePanel.value).toBe('layers')

    await act(async () => { locating.open!.value = false })
    expect(container.querySelector('[data-testid="layers"]')).not.toBeNull()
  })

  it('closes a stale side-panel selection that the active edition does not support', async () => {
    sidePanel.value = 'design-notebook'
    await act(async () => {
      render(
        <WorkspaceComposition
          panelProjection={projection()}
          surfaces={{ primary: { canvas: Canvas }, side: {} }}
        />,
        container,
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="canvas"]')).not.toBeNull()
    expect(container.querySelector('[data-workspace-side-panel]')).toBeNull()
    expect(sidePanel.value).toBeNull()
  })

  it('rejects command and surface drift before an unsupported panel can mount', () => {
    expect(() => validateWorkspaceSurfaces(
      projection({ design: ['calendar'] }),
      { primary: { canvas: Canvas }, side: {} },
    )).toThrow(/missing surfaces: calendar/)

    expect(() => validateWorkspaceSurfaces(
      projection(),
      { primary: { canvas: Canvas }, side: { favorites: Favorites } },
    )).toThrow(/unreachable surfaces: favorites/)

    expect(() => validateWorkspaceSurfaces(
      projection({ primary: ['canvas', 'calendar'] }),
      { primary: { canvas: Canvas }, side: {} },
    )).toThrow(/calendar.*wrong panel group/)
  })
})

function Canvas() {
  return <div data-testid="canvas" />
}

function Templates() {
  return <div data-testid="templates" />
}

function Calendar() {
  return <div>Calendar panel</div>
}

function Budget() {
  return <div>Budget panel</div>
}

function Favorites() {
  return <div>Favorites panel</div>
}

function button(container: HTMLElement, testId: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`Missing ${testId}`)
  return element
}
