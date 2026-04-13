import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentChildren } from 'preact'
import type { ConsortiumRenderState } from '../canvas/consortium-renderer'

const { renderConsortiumMock } = vi.hoisted(() => ({
  renderConsortiumMock: vi.fn(),
}))

vi.mock('../canvas/consortium-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../canvas/consortium-renderer')>()
  return {
    ...actual,
    renderConsortium: renderConsortiumMock,
  }
})

vi.mock('../components/canvas/useCanvasRenderer', () => ({
  useCanvasRenderer: (
    _canvasRef: unknown,
    renderCanvas: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  ) => {
    renderCanvas({} as CanvasRenderingContext2D, 800, 216)
  },
}))

import { ConsortiumChart } from '../components/canvas/ConsortiumChart'
import { currentCanvasSession } from '../canvas/session'
import { currentDesign } from '../state/design'
import { hoveredCanvasTargets, hoveredPanelTargets } from '../app/panel-targets/state'
import {
  plantNamesRevision,
  sceneEntityRevision,
} from '../state/canvas'
import { consortiumTarget, speciesTarget } from '../panel-targets'
import type { CanopiFile, PlacedPlant } from '../types/design'

function makeDesign(): CanopiFile {
  return {
    version: 2,
    name: 'Consortium chart hover test',
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [
      { target: consortiumTarget('Malus domestica'), stratum: 'high', start_phase: 0, end_phase: 2 },
      { target: consortiumTarget('Acer campestre'), stratum: 'medium', start_phase: 0, end_phase: 2 },
    ],
    groups: [],
    timeline: [],
    budget: [],
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
  }
}

function makePlant(canonicalName: string, commonName: string): PlacedPlant {
  return {
    id: `plant-${canonicalName}`,
    canonical_name: canonicalName,
    common_name: commonName,
    color: null,
    position: { x: 0, y: 0 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: 1,
  }
}

function latestHoverState(): ConsortiumRenderState | null {
  const lastCall = renderConsortiumMock.mock.calls[renderConsortiumMock.mock.calls.length - 1]
  return (lastCall?.[4] as ConsortiumRenderState | undefined) ?? null
}

function App({ children }: { children: ComponentChildren }) {
  return <>{children}</>
}

describe('ConsortiumChart canvas hover bridge', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    renderConsortiumMock.mockClear()
    hoveredCanvasTargets.value = []
    hoveredPanelTargets.value = []
    sceneEntityRevision.value = 0
    plantNamesRevision.value = 0
    currentDesign.value = makeDesign()
    currentCanvasSession.value = {
      getPlacedPlants: () => [
        makePlant('Malus domestica', 'Apple'),
        makePlant('Acer campestre', 'Field maple'),
      ],
      getLocalizedCommonNames: () => new Map(),
    } as any
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentDesign.value = null
    currentCanvasSession.value = null
    hoveredCanvasTargets.value = []
    hoveredPanelTargets.value = []
  })

  it('uses canvas-origin species hover when the chart has no local hover', async () => {
    hoveredCanvasTargets.value = [speciesTarget('Acer campestre')]

    await act(async () => {
      render(<App><ConsortiumChart /></App>, container)
    })

    expect(latestHoverState()?.hoveredCanonical).toBe('Acer campestre')
  })

  it('lets local chart hover take precedence and only clears chart-origin hover on leave', async () => {
    hoveredCanvasTargets.value = [speciesTarget('Acer campestre')]

    await act(async () => {
      render(<App><ConsortiumChart /></App>, container)
    })

    const canvas = container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    Object.defineProperty(canvas!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 216,
        width: 800,
        height: 216,
      }),
    })

    await act(async () => {
      canvas!.dispatchEvent(new MouseEvent('mousemove', { clientX: 270, clientY: 90, bubbles: true }))
    })

    expect(latestHoverState()?.hoveredCanonical).toBe('Malus domestica')
    expect(hoveredPanelTargets.value).toEqual([consortiumTarget('Malus domestica')])

    await act(async () => {
      canvas!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    })

    expect(hoveredPanelTargets.value).toEqual([])
    expect(hoveredCanvasTargets.value).toEqual([speciesTarget('Acer campestre')])
  })
})
