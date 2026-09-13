import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BudgetPanel } from '../components/panels/BudgetPanel'
import { setCurrentCanvasSession } from '../canvas/session'
import { locale } from '../app/settings/state'
import { hoveredPanelTargets } from '../app/panel-targets/state'
import { designSessionFixture } from './support/design-session-state'
import { speciesBudgetTarget } from '../target'
import type { CanopiFile, PlacedPlant } from '../types/design'
import {
  createTestCanvasQuerySurface,
  type TestCanvasQuerySurface,
} from './support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'Budget hover test',
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
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
    ...overrides,
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
    locked: false,
  }
}

describe('BudgetPanel hover bridge', () => {
  let container: HTMLDivElement
  let querySurface: TestCanvasQuerySurface

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    hoveredPanelTargets.value = []
    designSessionFixture.file = makeDesign({
      budget_currency: 'EUR',
      budget: [
        {
          target: speciesBudgetTarget('Malus domestica'),
          category: 'plants',
          description: 'Malus domestica',
          quantity: 0,
          unit_cost: 5,
          currency: 'EUR',
        },
      ],
    })
    querySurface = createTestCanvasQuerySurface({
      plants: [makePlant('Malus domestica', 'Apple')],
    })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: querySurface }))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    designSessionFixture.file = null
    setCurrentCanvasSession(null)
    hoveredPanelTargets.value = []
  })

  it('emits and clears hovered panel targets for budget rows', async () => {
    await act(async () => {
      render(<BudgetPanel />, container)
    })

    const row = container.querySelector('li')
    expect(row).not.toBeNull()

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    })
    expect(hoveredPanelTargets.value).toEqual([speciesBudgetTarget('Malus domestica')])

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
    })
    expect(hoveredPanelTargets.value).toEqual([])
  })

  it('refreshes localized species names when switching to a cached locale', async () => {
    querySurface = createTestCanvasQuerySurface({
      plants: [makePlant('Malus domestica', 'Fallback Apple')],
      localizedNames: new Map([
        ['Malus domestica', locale.value === 'fr' ? 'Pommier' : 'Apple'],
      ]),
    })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: querySurface }))

    await act(async () => {
      render(<BudgetPanel />, container)
    })

    expect(container.textContent).toContain('Apple')

    await act(async () => {
      locale.value = 'fr'
      querySurface.setLocalizedNames(new Map([
        ['Malus domestica', 'Pommier'],
      ]))
    })

    expect(container.textContent).toContain('Pommier')
    expect(container.textContent).not.toContain('Apple')
  })
})
