import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BudgetTab } from '../components/canvas/BudgetTab'
import { currentCanvasSession } from '../canvas/session'
import { locale } from '../app/settings/state'
import { hoveredPanelTargets, selectedPanelTargetOrigin, selectedPanelTargets } from '../app/panel-targets/state'
import { currentDesign } from './support/design-session-state'
import { speciesBudgetTarget } from '../target'
import type { CanopiFile, PlacedPlant } from '../types/design'
import styles from '../components/canvas/BudgetTab.module.css'
import {
  createTestCanvasQuerySurface,
  type TestCanvasQuerySurface,
} from './support/canvas-query-surface'

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

describe('BudgetTab hover bridge', () => {
  let container: HTMLDivElement
  let querySurface: TestCanvasQuerySurface

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
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
    querySurface = createTestCanvasQuerySurface({
      plants: [makePlant('Malus domestica', 'Apple')],
    })
    currentCanvasSession.value = querySurface as any
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentDesign.value = null
    currentCanvasSession.value = null
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
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

  it('emits selected panel targets for budget rows without changing hover', async () => {
    await act(async () => {
      render(<BudgetTab />, container)
    })

    const row = container.querySelector('tbody tr')
    expect(row).not.toBeNull()

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(selectedPanelTargets.value).toEqual([speciesBudgetTarget('Malus domestica')])
    expect(selectedPanelTargetOrigin.value).toBe('budget')
    expect(hoveredPanelTargets.value).toEqual([])
  })

  it('clears selected panel targets when the selected budget row disappears', async () => {
    await act(async () => {
      render(<BudgetTab />, container)
    })

    const row = container.querySelector('tbody tr')
    expect(row).not.toBeNull()

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(selectedPanelTargets.value).toEqual([speciesBudgetTarget('Malus domestica')])
    expect(selectedPanelTargetOrigin.value).toBe('budget')

    await act(async () => {
      querySurface.setPlants([])
      querySurface.bumpSceneRevision()
    })

    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
  })

  it('does not clear timeline-owned selection on budget rerender', async () => {
    selectedPanelTargetOrigin.value = 'timeline'
    selectedPanelTargets.value = [speciesBudgetTarget('Malus domestica')]

    await act(async () => {
      render(<BudgetTab />, container)
    })

    expect(selectedPanelTargets.value).toEqual([speciesBudgetTarget('Malus domestica')])
    expect(selectedPanelTargetOrigin.value).toBe('timeline')
    expect(container.querySelector(`.${styles.rowSelected}`)).toBeNull()
  })

  it('refreshes localized species names when switching to a cached locale', async () => {
    querySurface = createTestCanvasQuerySurface({
      plants: [makePlant('Malus domestica', 'Fallback Apple')],
      localizedNames: new Map([
        ['Malus domestica', locale.value === 'fr' ? 'Pommier' : 'Apple'],
      ]),
    })
    currentCanvasSession.value = querySurface as any

    await act(async () => {
      render(<BudgetTab />, container)
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
