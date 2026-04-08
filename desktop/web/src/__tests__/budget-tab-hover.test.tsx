import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BudgetTab } from '../components/canvas/BudgetTab'
import { currentCanvasSession } from '../canvas/session'
import { locale } from '../state/app'
import { currentDesign } from '../state/document'
import { hoveredPanelTargets, plantNamesRevision, sceneEntityRevision } from '../state/canvas'
import { speciesBudgetTarget } from '../panel-targets'
import type { CanopiFile, PlacedPlant } from '../types/design'

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
  }
}

describe('BudgetTab hover bridge', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    hoveredPanelTargets.value = []
    sceneEntityRevision.value = 0
    plantNamesRevision.value = 0
    currentDesign.value = makeDesign({
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
    currentCanvasSession.value = {
      getPlacedPlants: () => [makePlant('Malus domestica', 'Apple')],
      getLocalizedCommonNames: () => new Map(),
    } as any
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentDesign.value = null
    currentCanvasSession.value = null
    hoveredPanelTargets.value = []
  })

  it('emits and clears hovered panel targets for budget rows', async () => {
    await act(async () => {
      render(<BudgetTab />, container)
    })

    const row = container.querySelector('tbody tr')
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
})
